import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/spot/$id')({ component: SpotDetail })

function SpotDetail() {
  const { id } = Route.useParams()
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Spot {id}</h1>
      <p className="mt-2 text-gray-600">Detail page — Phase C will fill this in.</p>
    </div>
  )
}
