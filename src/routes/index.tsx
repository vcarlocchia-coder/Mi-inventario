import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexComponent,
})

function IndexComponent() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>📦 Stock al Día</h1>
      <p>¡El sistema se ha desplegado con éxito en Vercel!</p>
    </div>
  )
}
