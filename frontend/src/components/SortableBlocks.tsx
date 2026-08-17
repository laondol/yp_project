import { useState, useCallback, useRef, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import DraggableBlock from './DraggableBlock'

interface SortableBlocksProps {
  order: string[]
  onReorder: (newOrder: string[]) => void
  children: Record<string, ReactNode>
  dragEnabled?: boolean
}

function CollapseItem({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () => setOverflowing(el.offsetHeight > 336)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <>
      <div
        style={{
          minHeight: 320,
          maxHeight: expanded ? 'none' : 320,
          overflow: expanded ? 'visible' : 'hidden',
          transition: 'max-height 0.2s ease',
        }}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {overflowing && (
        <div className="text-center mt-1">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="btn btn-link btn-sm p-0"
            style={{ color: '#888', fontSize: 18, textDecoration: 'none' }}
            aria-label={expanded ? '접기' : '더 보기'}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      )}
    </>
  )
}

export default function SortableBlocks({
  order, onReorder, children, dragEnabled = true,
}: SortableBlocksProps) {
  const [dragId, setDragId] = useState<string | null>(null)

  const handleDragStart = useCallback((id: string) => {
    setDragId(id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId) return
    const newOrder = [...order]
    const srcIdx = newOrder.indexOf(sourceId)
    const tgtIdx = newOrder.indexOf(targetId)
    if (srcIdx === -1 || tgtIdx === -1) return
    newOrder.splice(srcIdx, 1)
    newOrder.splice(tgtIdx, 0, sourceId)
    onReorder(newOrder)
    setDragId(null)
  }, [order, onReorder])

  const handleDragEnd = useCallback(() => {
    setDragId(null)
  }, [])

  const moveBlock = useCallback((id: string, direction: -1 | 1) => {
    const idx = order.indexOf(id)
    if (idx === -1) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= order.length) return
    const newOrder = [...order]
    newOrder.splice(idx, 1)
    newOrder.splice(newIdx, 0, id)
    onReorder(newOrder)
  }, [order, onReorder])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '16px',
        alignItems: 'start',
      }}
    >
      {order.map(key => {
        if (!children[key]) return null
        return (
          <div
            key={key}
            style={{ position: 'relative' }}
            onDragOver={dragEnabled ? handleDragOver : undefined}
            onDrop={dragEnabled ? (e) => handleDrop(e, key) : undefined}
          >
            <CollapseItem>
              {dragEnabled ? (
                <DraggableBlock
                  id={key}
                  dragging={dragId === key}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onMoveUp={(id) => moveBlock(id, -1)}
                  onMoveDown={(id) => moveBlock(id, 1)}
                >
                  {children[key]}
                </DraggableBlock>
              ) : (
                children[key]
              )}
            </CollapseItem>
          </div>
        )
      })}
    </div>
  )
}
