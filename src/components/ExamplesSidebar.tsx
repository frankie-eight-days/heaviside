import type { Scene, SceneCategory } from '../scenes'

interface ExamplesSidebarProps {
  scenes: Scene[]
  activeSceneId: string | null
  onSelect: (scene: Scene) => void
}

const CATEGORY_LABEL: Record<SceneCategory, string> = {
  antennas: 'Antennas',
  pcb: 'PCB structures',
}

const CATEGORY_ORDER: SceneCategory[] = ['antennas', 'pcb']

export default function ExamplesSidebar({
  scenes,
  activeSceneId,
  onSelect,
}: ExamplesSidebarProps) {
  return (
    <aside className="examples-sidebar">
      <div className="examples-header">Examples</div>
      {CATEGORY_ORDER.map((category) => {
        const inCategory = scenes.filter((s) => s.category === category)
        if (inCategory.length === 0) return null
        return (
          <section key={category} className="examples-section">
            <h3 className="examples-category">{CATEGORY_LABEL[category]}</h3>
            <ul className="examples-list">
              {inCategory.map((scene) => (
                <li key={scene.id}>
                  <button
                    type="button"
                    className={
                      'examples-item' +
                      (activeSceneId === scene.id ? ' examples-item--active' : '')
                    }
                    onClick={() => onSelect(scene)}
                  >
                    <span className="examples-item-name">{scene.name}</span>
                    <span className="examples-item-desc">{scene.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
