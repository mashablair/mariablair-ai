import { useQuery } from '@tanstack/react-query'
import { repo } from '@/data'
import { Card, Notice, PageHeader, Spinner } from '@/ui/kit'

export function Dashboard() {
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: () => repo().list('contacts') })
  return (
    <>
      <PageHeader label="Admin" title="Today" />
      {contacts.isPending ? <Spinner /> : contacts.isError ? (
        <Notice tone="danger">Could not load data: {contacts.error.message}</Notice>
      ) : (
        <Card className="max-w-xs">
          <p className="label-caps">Contacts</p>
          <p className="font-display text-5xl">{contacts.data.length}</p>
        </Card>
      )}
    </>
  )
}
