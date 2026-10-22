// Generates `dart_defines.json` from `.env` so IDE launch configs and CI can
// build with `--dart-define-from-file=dart_defines.json` without hand-editing.
//
// Usage: dart run tool/gen_dart_defines.dart
//
// `.env` holds one KEY=value per line; lines starting with # and blank lines
// are ignored. Keys with empty values are skipped (the app's Env class falls
// back to its built-in default). `dart_defines.json` is gitignored.

import 'dart:convert';
import 'dart:io';

void main() {
  final envFile = File('.env');
  if (!envFile.existsSync()) {
    stderr.writeln('No .env found — copy .env.example to .env and fill it in.');
    exitCode = 1;
    return;
  }

  final defines = <String, String>{};
  for (final rawLine in envFile.readAsLinesSync()) {
    final line = rawLine.trim();
    if (line.isEmpty || line.startsWith('#')) continue;
    final eq = line.indexOf('=');
    if (eq <= 0) continue;
    final key = line.substring(0, eq).trim();
    final value = line.substring(eq + 1).trim();
    if (value.isEmpty) continue;
    defines[key] = value;
  }

  File('dart_defines.json').writeAsStringSync(
    const JsonEncoder.withIndent('  ').convert(defines) + '\n',
  );
  stdout.writeln(
    'Wrote dart_defines.json with ${defines.length} define(s): '
    '${defines.keys.join(', ')}',
  );
}
