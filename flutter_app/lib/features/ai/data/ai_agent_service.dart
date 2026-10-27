import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_agent_tools.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_gateway_service.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';

/// One step of the agent loop (Grok-style "what it's doing" panel):
/// search / fetch / answer, with the tool name + a short status.
class AgentStep {
  final String tool;
  final String status;
  final bool done;
  const AgentStep({required this.tool, required this.status, this.done = false});
}

/// The result of an agent run: the final answer + the steps it took.
class AgentResult {
  final String answer;
  final List<AgentStep> steps;
  final AiUsage? usage;
  const AgentResult({required this.answer, required this.steps, this.usage});
}

/// The AI agent — a bounded tool-calling loop (OpenRouter function calling),
/// NOT a bare chatbot. The model calls read-only Nostr tools
/// (search/thread/profile/hashtag), the app executes them locally, appends
/// results, and loops until the model stops calling tools or the round cap
/// hits — then the model answers grounded in the real data it just read.
///
/// Private-key rule: the model NEVER sees a key. These are READ-ONLY tools.
class AiAgentService {
  final AiAgentTools _tools;
  final String _apiKey;
  AiAgentService(this._tools, {String? apiKey})
      : _apiKey = apiKey ?? Env.openRouterApiKey;

  static const _maxRounds = 4;
  static const _requestTimeout = Duration(seconds: 30);

  static const _agentSystemPrompt =
      'You are NostrFeed AI in AGENT mode — like Grok on X. '
      'To answer Nostr questions you USE the provided tools (search_relay, '
      'fetch_thread, fetch_profile, fetch_hashtag_feed) instead of guessing. '
      'Plan briefly, call tools to gather real data, then answer concisely '
      'with what you actually found (authors, content, counts). '
      'Never invent posts or stats. Never ask for or repeat private keys. '
      'When the question needs no Nostr data, answer directly without tools.';

  /// Run the agent on [userText]. Emits [AgentStep]s on [onStep] as the loop
  /// works (for the Grok-style steps panel), then returns the final answer.
  Future<AgentResult> run(
    String userText, {
    required AiProviderConfig provider,
    required String modelId,
    required void Function(AgentStep) onStep,
  }) async {
    final steps = <AgentStep>[];
    final messages = <Map<String, dynamic>>[
      {'role': 'system', 'content': _agentSystemPrompt},
      {'role': 'user', 'content': userText},
    ];

    AiUsage? usage;

    for (var round = 0; round < _maxRounds; round++) {
      final response = await _chat(
        provider: provider,
        modelId: modelId,
        messages: messages,
        withTools: true,
      );

      final choice = response['choices']?[0] as Map<String, dynamic>?;
      final message = choice?['message'] as Map<String, dynamic>?;
      if (message == null) break;
      // SUM usage across EVERY round — each round is a separate billed API
      // call (the old code kept only the LAST round's usage, undercharging a
      // multi-step run by the earlier rounds' cost).
      if (response['usage'] != null) {
        final roundUsage = AiUsage.tryParse(
          response['usage'] as Map<String, dynamic>?,
          (response['model'] as String?) ?? modelId,
        );
        if (roundUsage != null) {
          usage = usage == null
              ? roundUsage
              : AiUsage(
                  promptTokens: usage.promptTokens + roundUsage.promptTokens,
                  completionTokens:
                      usage.completionTokens + roundUsage.completionTokens,
                  costUsd: usage.costUsd + roundUsage.costUsd,
                  model: roundUsage.model,
                );
        }
      }

      final toolCalls = message['tool_calls'] as List? ?? [];
      if (toolCalls.isEmpty) {
        // Done — the model produced the final answer.
        final answer = (message['content'] as String? ?? '').trim();
        onStep(const AgentStep(tool: 'answer', status: 'Done', done: true));
        return AgentResult(answer: answer, steps: steps, usage: usage);
      }

      // Execute each tool call locally, append results, loop.
      messages.add(message);
      for (final call in toolCalls) {
        final fn = call['function'] as Map<String, dynamic>? ?? {};
        final name = fn['name'] as String? ?? '';
        final args = fn['arguments'] as String? ?? '{}';
        final callId = call['id'] as String? ?? '';

        onStep(AgentStep(
          tool: name,
          status: _statusFor(name, args),
        ));
        final step = AgentStep(tool: name, status: _statusFor(name, args));
        steps.add(step);

        final result = await _tools.execute(name, args);

        onStep(AgentStep(tool: name, status: _statusFor(name, args), done: true));

        messages.add({
          'role': 'tool',
          'tool_call_id': callId,
          'name': name,
          'content': result,
        });
      }
    }

    // Round cap hit without a clean finish — ask for the answer with what
    // the loop already gathered.
    messages.add({
      'role': 'user',
      'content': 'Answer now with what you found (briefly).',
    });
    final response = await _chat(
      provider: provider,
      modelId: modelId,
      messages: messages,
      withTools: false,
    );
    final choice = response['choices']?[0] as Map<String, dynamic>?;
    final message = choice?['message'] as Map<String, dynamic>?;
    final answer = (message?['content'] as String? ?? '').trim();
    if (response['usage'] != null) {
      // Sum the final answer round's usage onto the loop's rounds too.
      final finalUsage = AiUsage.tryParse(
        response['usage'] as Map<String, dynamic>?,
        (response['model'] as String?) ?? modelId,
      );
      if (finalUsage != null) {
        usage = usage == null
            ? finalUsage
            : AiUsage(
                promptTokens: usage.promptTokens + finalUsage.promptTokens,
                completionTokens:
                    usage.completionTokens + finalUsage.completionTokens,
                costUsd: usage.costUsd + finalUsage.costUsd,
                model: finalUsage.model,
              );
      }
    }
    onStep(const AgentStep(tool: 'answer', status: 'Done', done: true));
    return AgentResult(answer: answer, steps: steps, usage: usage);
  }

  /// One non-streaming chat completion with tool definitions.
  Future<Map<String, dynamic>> _chat({
    required AiProviderConfig provider,
    required String modelId,
    required List<Map<String, dynamic>> messages,
    required bool withTools,
  }) async {
    final request = http.Request(
      'POST',
      Uri.parse('${provider.baseUrl}/chat/completions'),
    );
    request.headers.addAll({
      'Authorization': 'Bearer $_apiKey',
      'Content-Type': 'application/json',
      if (provider.referer != null) 'HTTP-Referer': provider.referer!,
      if (provider.title != null) 'X-OpenRouter-Title': provider.title!,
    });
    request.body = jsonEncode({
      'model': modelId,
      'messages': messages,
      if (withTools) 'tools': AiAgentTools.definitions(),
      if (withTools) 'tool_choice': 'auto',
      'max_tokens': 2048,
      'usage': {'include': true},
    });

    final response = await http.Client()
        .send(request)
        .timeout(_requestTimeout);
    final body = await response.stream.bytesToString();
    if (response.statusCode != 200) {
      throw AiGatewayException(
        statusCode: response.statusCode,
        message: 'Agent request failed (${response.statusCode})',
      );
    }
    return jsonDecode(body) as Map<String, dynamic>;
  }

  String _statusFor(String tool, String args) {
    try {
      final a = jsonDecode(args) as Map<String, dynamic>;
      return switch (tool) {
        'search_relay' => 'Searching "${a['query']}"…',
        'fetch_thread' => 'Reading the thread…',
        'fetch_profile' => 'Fetching the profile…',
        'fetch_hashtag_feed' => 'Reading #${a['tag']}…',
        _ => 'Working…',
      };
    } catch (_) {
      return 'Working…';
    }
  }
}
