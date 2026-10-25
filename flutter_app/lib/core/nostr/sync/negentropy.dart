import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// NIP-77 / Negentropy protocol v1 — a faithful Dart port of hoytech's
/// reference `js/Negentropy.js` (MIT), which is what strfry relays speak.
///
/// Purpose: reconcile two sets of (timestamp, id) records with bandwidth
/// proportional to the set DIFFERENCE, not the set size — after a 12 h
/// offline gap this is a few KB instead of re-pulling the whole window.
///
/// Both roles live in [Negentropy] (like the reference): the client
/// (`isInitiator = true`) [initiate]s and learns `haveIds`/`needIds` from
/// IdList ranges; the responder [reconcile]s each message and answers.
///
/// Wire format (NIP-77 appendix):
/// - message = `0x61` version byte + Range*; ranges are adjacent, ordered,
///   and cover the full (timestamp, id) space.
/// - Range = Bound + mode-varint + payload (0=Skip, 1=Fingerprint(16B),
///   2=IdList(varint n + n×32B ids)).
/// - Bound = timestamp-varint (0 = infinity; else 1 + offset from previous
///   bound's timestamp) + idPrefix-len-varint + idPrefix bytes.
class Negentropy {
  Negentropy(this.storage, {this.frameSizeLimit = 0}) {
    if (frameSizeLimit != 0 && frameSizeLimit < 4096) {
      throw ArgumentError('frameSizeLimit too small');
    }
  }

  static const protocolVersion = 0x61;
  static const idSize = 32;
  static const fingerprintSize = 16;
  static const _buckets = 16;

  /// Records (kept sealed+sorted by [NegentropyStorage]).
  final NegentropyStorage storage;

  /// Soft cap on output message size (0 = unlimited); matches the reference.
  final int frameSizeLimit;

  bool isInitiator = false;

  int _lastTimestampIn = 0;
  int _lastTimestampOut = 0;

  /// First message (initiator only): split the whole record space.
  Uint8List initiate() {
    if (isInitiator) throw StateError('already initiated');
    isInitiator = true;
    _lastTimestampOut = 0;
    final out = _Buffer()..writeByte(protocolVersion);
    _splitRange(0, storage.size, NegentropyBound.infinity(), out);
    return out.bytes;
  }

  /// Process an incoming message. Returns the reply message (or `null` when
  /// the initiator is satisfied — its output collapsed to just the version
  /// byte), plus the id sets learned (initiator: IdList diffs).
  ({Uint8List? reply, List<Uint8List> haveIds, List<Uint8List> needIds})
      reconcile(Uint8List input) {
    final haveIds = <Uint8List>[];
    final needIds = <Uint8List>[];
    final query = _Reader(input);

    _lastTimestampIn = _lastTimestampOut = 0;

    final fullOutput = _Buffer()..writeByte(protocolVersion);

    final version = query.readByte();
    if (version < 0x60 || version > 0x6F) {
      throw const FormatException('invalid negentropy protocol version byte');
    }
    if (version != protocolVersion) {
      if (isInitiator) {
        throw FormatException(
          'unsupported negentropy protocol version: ${version - 0x60}',
        );
      }
      // Responder: answer with our own max version byte and nothing else.
      return (reply: fullOutput.bytes, haveIds: haveIds, needIds: needIds);
    }

    final storageSize = storage.size;
    var prevBound = const NegentropyBound(0, null);
    var prevIndex = 0;
    var skip = false;

    while (!query.done) {
      var o = _Buffer();

      void doSkip() {
        if (skip) {
          skip = false;
          o.write(_encodeBound(prevBound));
          o.write(_encodeVarint(0)); // Mode.Skip
        }
      }

      final currBound = _decodeBound(query);
      final mode = query.readVarint();

      final lower = prevIndex;
      final upper = storage.findLowerBound(prevIndex, storageSize, currBound);

      if (mode == 0) {
        // Skip.
        skip = true;
      } else if (mode == 1) {
        // Fingerprint.
        final theirFingerprint = query.readBytes(fingerprintSize);
        final ourFingerprint = storage.fingerprint(lower, upper);
        if (!_bytesEqual(theirFingerprint, ourFingerprint)) {
          doSkip();
          _splitRange(lower, upper, currBound, o);
        } else {
          skip = true;
        }
      } else if (mode == 2) {
        // IdList.
        final numIds = query.readVarint();
        final theirIds = <String, Uint8List>{};
        for (var i = 0; i < numIds; i++) {
          final id = query.readBytes(idSize);
          if (isInitiator) theirIds[_key(id)] = id;
        }

        if (isInitiator) {
          skip = true;
          storage.iterate(lower, upper, (item, index) {
            final k = _key(item.id);
            if (!theirIds.containsKey(k)) {
              haveIds.add(item.id); // ours, not theirs
            } else {
              theirIds.remove(k);
            }
            return true;
          });
          needIds.addAll(theirIds.values); // theirs, not ours
        } else {
          // Responder: answer with our own IdList (bounded by frame size).
          doSkip();
          final responseIds = _Buffer();
          var numResponseIds = 0;
          var endBound = currBound;
          storage.iterate(lower, upper, (item, index) {
            if (_exceededFrameSizeLimit(
                fullOutput.length + responseIds.length)) {
              endBound = NegentropyBound(item.timestamp, item.id);
              return false;
            }
            responseIds.write(item.id);
            numResponseIds++;
            return true;
          });
          o.write(_encodeBound(endBound));
          o.write(_encodeVarint(2));
          o.write(_encodeVarint(numResponseIds));
          o.write(responseIds.bytes);
          fullOutput.write(o.bytes);
          o = _Buffer();
        }
      } else {
        throw const FormatException('unexpected negentropy mode');
      }

      if (_exceededFrameSizeLimit(fullOutput.length + o.length)) {
        // Budget blown: cover the remainder with one fingerprint and stop.
        final remaining = storage.fingerprint(upper, storageSize);
        fullOutput.write(_encodeBound(NegentropyBound.infinity()));
        fullOutput.write(_encodeVarint(1));
        fullOutput.write(remaining);
        break;
      } else {
        fullOutput.write(o.bytes);
      }

      prevIndex = upper;
      prevBound = currBound;
    }

    final collapsed = fullOutput.length == 1 && isInitiator;
    return (
      reply: collapsed ? null : fullOutput.bytes,
      haveIds: haveIds,
      needIds: needIds,
    );
  }

  // ── Range splitting (reference-faithful: 16 buckets, small → IdList) ──

  void _splitRange(int lower, int upper, NegentropyBound upperBound, _Buffer o) {
    final numElems = upper - lower;
    if (numElems < _buckets * 2) {
      o.write(_encodeBound(upperBound));
      o.write(_encodeVarint(2)); // IdList
      o.write(_encodeVarint(numElems));
      storage.iterate(lower, upper, (item, index) {
        o.write(item.id);
        return true;
      });
      return;
    }
    final itemsPerBucket = numElems ~/ _buckets;
    final bucketsWithExtra = numElems % _buckets;
    var curr = lower;
    for (var i = 0; i < _buckets; i++) {
      final bucketSize = itemsPerBucket + (i < bucketsWithExtra ? 1 : 0);
      final ourFingerprint = storage.fingerprint(curr, curr + bucketSize);
      curr += bucketSize;
      final NegentropyBound nextBound;
      if (curr == upper) {
        nextBound = upperBound;
      } else {
        nextBound =
            _minimalBound(storage.getItem(curr - 1), storage.getItem(curr));
      }
      o.write(_encodeBound(nextBound));
      o.write(_encodeVarint(1)); // Fingerprint
      o.write(ourFingerprint);
    }
  }

  NegentropyBound _minimalBound(NegentropyItem prev, NegentropyItem curr) {
    if (curr.timestamp != prev.timestamp) return NegentropyBound(curr.timestamp, null);
    var shared = 0;
    for (var i = 0; i < idSize; i++) {
      if (curr.id[i] != prev.id[i]) break;
      shared++;
    }
    return NegentropyBound(
      curr.timestamp,
      Uint8List.fromList(curr.id.sublist(0, shared + 1)),
    );
  }

  // ── Bound / varint codecs ─────────────────────────────────────────────

  int _decodeTimestampIn(_Reader r) {
    var ts = r.readVarint();
    ts = ts == 0 ? _maxTs : ts - 1;
    if (_lastTimestampIn == _maxTs || ts == _maxTs) {
      _lastTimestampIn = _maxTs;
      return _maxTs;
    }
    ts += _lastTimestampIn;
    _lastTimestampIn = ts;
    return ts;
  }

  NegentropyBound _decodeBound(_Reader r) {
    final ts = _decodeTimestampIn(r);
    final len = r.readVarint();
    if (len > idSize) throw const FormatException('bound key too long');
    return NegentropyBound(ts, r.readBytes(len));
  }

  List<int> _encodeTimestampOut(int timestamp) {
    if (timestamp == _maxTs) {
      _lastTimestampOut = _maxTs;
      return _encodeVarint(0);
    }
    final temp = timestamp;
    timestamp -= _lastTimestampOut;
    _lastTimestampOut = temp;
    return _encodeVarint(timestamp + 1);
  }

  List<int> _encodeBound(NegentropyBound bound) => [
        ..._encodeTimestampOut(bound.timestamp),
        ..._encodeVarint(bound.idPrefix?.length ?? 0),
        ...?bound.idPrefix,
      ];

  bool _exceededFrameSizeLimit(int n) =>
      frameSizeLimit != 0 && n > frameSizeLimit - 200;

  static const _maxTs = 0x7FFFFFFFFFFFFFFF; // sentinel "infinity" timestamp

  static String _key(Uint8List id) => base64Encode(id);

  static bool _bytesEqual(Uint8List a, Uint8List b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  static List<int> _encodeVarint(int n) {
    if (n == 0) return [0];
    final digits = <int>[];
    while (n != 0) {
      digits.add(n & 127);
      n >>= 7;
    }
    final reversed = digits.reversed.toList();
    for (var i = 0; i < reversed.length - 1; i++) {
      reversed[i] |= 128;
    }
    return reversed;
  }
}

/// One record: a 64-bit timestamp + a 32-byte id.
class NegentropyItem {
  const NegentropyItem(this.timestamp, this.id);
  final int timestamp;
  final Uint8List id;
}

class NegentropyBound {
  const NegentropyBound(this.timestamp, this.idPrefix);
  factory NegentropyBound.infinity() => const NegentropyBound(Negentropy._maxTs, null);
  final int timestamp;
  final Uint8List? idPrefix; // null = 0-length prefix
}

/// Sorted record storage (reference `NegentropyStorageVector`).
class NegentropyStorage {
  final _items = <NegentropyItem>[];
  bool _sealed = false;

  void insert(int timestamp, Uint8List id) {
    if (_sealed) throw StateError('already sealed');
    if (id.length != Negentropy.idSize) {
      throw ArgumentError('bad id size');
    }
    _items.add(NegentropyItem(timestamp, id));
  }

  /// Sort by (timestamp, id) and reject duplicates. Must be called before
  /// any query.
  void seal() {
    _items.sort(_compare);
    for (var i = 1; i < _items.length; i++) {
      if (_compare(_items[i - 1], _items[i]) == 0) {
        throw StateError('duplicate item inserted');
      }
    }
    _sealed = true;
  }

  int get size => _items.length;

  NegentropyItem getItem(int i) => _items[i];

  void iterate(int begin, int end, bool Function(NegentropyItem, int) cb) {
    for (var i = begin; i < end; i++) {
      if (!cb(_items[i], i)) break;
    }
  }

  /// First index in [begin, end) whose item >= [bound] (timestamp, then
  /// id-prefix padded with zeros).
  int findLowerBound(int begin, int end, NegentropyBound bound) {
    final boundId = Uint8List(Negentropy.idSize);
    final prefix = bound.idPrefix;
    if (prefix != null) {
      for (var i = 0; i < prefix.length && i < Negentropy.idSize; i++) {
        boundId[i] = prefix[i];
      }
    }
    final target = NegentropyItem(bound.timestamp, boundId);
    var first = begin, count = end - begin;
    while (count > 0) {
      var it = first;
      final step = count ~/ 2;
      it += step;
      if (_compare(_items[it], target) < 0) {
        first = ++it;
        count -= step + 1;
      } else {
        count = step;
      }
    }
    return first;
  }

  /// Fingerprint over [begin, end): sum of ids (32-byte little-endian
  /// integers mod 2^256) + count varint, sha256, first 16 bytes.
  Uint8List fingerprint(int begin, int end) {
    final acc = Uint8List(Negentropy.idSize); // little-endian accumulator
    var carry = 0;
    for (var i = begin; i < end; i++) {
      final id = _items[i].id;
      carry = 0;
      for (var w = 0; w < 8; w++) {
        final off = w * 4;
        var sum = _le32(acc, off) + _le32(id, off) + carry;
        carry = sum > 0xFFFFFFFF ? 1 : 0;
        _setLe32(acc, off, sum & 0xFFFFFFFF);
      }
    }
    final n = end - begin;
    final input = <int>[...acc, ...Negentropy._encodeVarint(n)];
    return Uint8List.fromList(
      sha256.convert(input).bytes.sublist(0, Negentropy.fingerprintSize),
    );
  }

  static int _le32(Uint8List b, int off) =>
      b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24);

  static void _setLe32(Uint8List b, int off, int v) {
    b[off] = v & 0xFF;
    b[off + 1] = (v >> 8) & 0xFF;
    b[off + 2] = (v >> 16) & 0xFF;
    b[off + 3] = (v >> 24) & 0xFF;
  }

  static int _compare(NegentropyItem a, NegentropyItem b) {
    if (a.timestamp != b.timestamp) return a.timestamp - b.timestamp;
    for (var i = 0; i < Negentropy.idSize; i++) {
      if (a.id[i] != b.id[i]) return a.id[i] - b.id[i];
    }
    return 0;
  }
}

/// Growable byte writer (reference WrappedBuffer).
class _Buffer {
  final _b = BytesBuilder(copy: false);
  int get length => _b.length;
  Uint8List get bytes => _b.toBytes();
  void writeByte(int v) => _b.addByte(v);
  void write(List<int> data) => _b.add(data);
}

/// Cursor reader over an incoming message.
class _Reader {
  _Reader(this._data);
  final Uint8List _data;
  var _pos = 0;

  bool get done => _pos >= _data.length;

  int readByte() {
    if (done) throw const FormatException('parse ends prematurely');
    return _data[_pos++];
  }

  Uint8List readBytes(int n) {
    if (_pos + n > _data.length) {
      throw const FormatException('parse ends prematurely');
    }
    final out = Uint8List.fromList(_data.sublist(_pos, _pos + n));
    _pos += n;
    return out;
  }

  int readVarint() {
    var res = 0;
    while (true) {
      final byte = readByte();
      res = (res << 7) | (byte & 127);
      if ((byte & 128) == 0) return res;
    }
  }
}
