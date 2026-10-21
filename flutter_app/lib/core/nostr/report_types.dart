/// NIP-56 report types (kind 1984). The `type` strings are the canonical
/// values relays and other clients expect in e/p tags.
enum Nip56ReportType {
  /// Child sexual abuse material / child safety concerns. Maps to NIP-56's
  /// `illegal` type — the correct bucket for CSAM and illegal content.
  illegal('illegal', 'Child safety / illegal content'),

  nudity('nudity', 'Nudity or sexual content'),
  malware('malware', 'Malware or harmful links'),
  profanity('profanity', 'Hate speech or harassment'),
  spam('spam', 'Spam or scam'),
  impersonation('impersonation', 'Impersonation'),
  other('other', 'Something else');

  const Nip56ReportType(this.type, this.label);
  final String type;
  final String label;
}
