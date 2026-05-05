import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Zürich Sunny Spots</h1>
      <p className="mt-4 text-lg text-gray-600">
        Map view coming online — Phase A scaffold ready.
      </p>
    </div>
  )
}
