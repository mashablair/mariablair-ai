-- Private bucket for the materials library. Clients reach a file only through a grant row.
insert into storage.buckets (id, name, public) values ('materials', 'materials', false)
on conflict (id) do nothing;

create policy materials_admin_all on storage.objects for all to authenticated
  using (bucket_id = 'materials' and public.is_admin())
  with check (bucket_id = 'materials' and public.is_admin());

create policy materials_client_read_granted on storage.objects for select to authenticated
  using (
    bucket_id = 'materials'
    and exists (
      select 1
      from public.materials m
      join public.material_grants g on g.material_id = m.id
      where m.storage_path = storage.objects.name
        and g.contact_id = public.my_contact_id()
    )
  );
