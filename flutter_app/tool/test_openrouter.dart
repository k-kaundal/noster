// Live OpenRouter smoke test — hits the real API with the env key.
// Run: dart run tool/test_openrouter.dart
// (Print-heavy, hits live services — the tool/ pattern, never CI.)

import 'dart:convert';
import 'dart:io';

const _envFile = '.env';

String _readKey() {
  final fromEnv = Platform.environment['OPENROUTER_API_KEY'];
  if (fromEnv != null && fromEnv.isNotEmpty) return fromEnv;
  for (final line in File(_envFile).readAsLinesSync()) {
    if (line.startsWith('OPENROUTER_API_KEY=')) {
      return line.substring('OPENROUTER_API_KEY='.length).trim();
    }
  }
  stderr.writeln('No OPENROUTER_API_KEY in environment or $_envFile');
  exit(1);
}

Future<void> main() async {
  final key = _readKey();
  final client = HttpClient();

  Future<Map<String, dynamic>> getJson(String path) async {
    final req = await client.getUrl(
      Uri.parse('https://openrouter.ai/api/v1$path'),
    );
    req.headers.set('Authorization', 'Bearer $key');
    final res = await req.close();
    final body = await res.transform(utf8.decoder).join();
    return jsonDecode(body) as Map<String, dynamic>;
  }

  print('== 1. Key status ==');
  final keyData = await getJson('/auth/key');
  final quota = keyData['data']['free_model_daily_requests'];
  print('   free tier: ${keyData['data']['is_free_tier']} · '
      'daily free: ${quota['used']}/${quota['limit']} used');

  print('== 2. Streaming chat (openrouter/free) ==');
  final req = await client.postUrl(
    Uri.parse('https://openrouter.ai/api/v1/chat/completions'),
  );
  req.headers
    ..set('Authorization', 'Bearer $key')
    ..set('Content-Type', 'application/json')
    ..set('Accept', 'text/event-stream');
  req.add(utf8.encode(jsonEncode({
    'model': 'openrouter/free',
    'messages': [
      {'role': 'user', 'content': 'Say "NostrFeed AI is live" and nothing else.'},
    ],
    'max_tokens': 40,
    'stream': true,
    'usage': {'include': true},
  })));
  final res = await req.close();
  print('   HTTP ${res.statusCode}');
  if (res.statusCode != 200) {
    print('   ${await res.transform(utf8.decoder).join()}');
    exit(1);
  }

  final reply = StringBuffer();
  Map<String, dynamic>? usage;
  String? model;
  var lineBuf = '';
  await for (final chunk in res.transform(utf8.decoder)) {
    lineBuf += chunk;
    final lines = lineBuf.split('\n');
    lineBuf = lines.removeLast();
    for (final line in lines) {
      final t = line.trim();
      if (!t.startsWith('data:') || t.contains('[DONE]')) continue;
      Map<String, dynamic> json;
      try {
        json = jsonDecode(t.substring(5)) as Map<String, dynamic>;
      } catch (_) {
        continue;
      }
      model ??= json['model'] as String?;
      final choices = json['choices'];
      if (choices is List && choices.isNotEmpty) {
        final delta = choices.first?['delta'];
        if (delta is Map && delta['content'] is String) {
          reply.write(delta['content']);
        }
      }
      if (json['usage'] is Map) {
        usage = json['usage'] as Map<String, dynamic>;
      }
    }
  }
  print('   model: $model');
  print('   reply: "${reply.toString().trim()}"');
  print('   usage: $usage');

  print('== 3. Quota after ==');
  final after = await getJson('/auth/key');
  final q2 = after['data']['free_model_daily_requests'];
  print('   daily free: ${q2['used']}/${q2['limit']} used '
      '(${q2['remaining']} remaining)');

  client.close();
  print('\nPASS — streaming + usage + quota all work end-to-end.');
}
