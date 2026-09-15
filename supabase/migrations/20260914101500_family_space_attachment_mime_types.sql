-- Family Space accepts ordinary family file attachments while preserving the bucket's private access policies.
begin;
update storage.buckets set allowed_mime_types = null where id = 'family-assets';
commit;
