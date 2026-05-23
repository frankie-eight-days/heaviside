import GPUCanvas from './components/GPUCanvas'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>EM Playground</h1>
        <span className="subtitle">
          Milestone 1 — WebGPU compute → render pipeline check (placeholder ripple, not FDTD yet)
        </span>
      </header>
      <main className="canvas-wrap">
        <GPUCanvas />
      </main>
    </div>
  )
}
