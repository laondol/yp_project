import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import DraggableBlock from './DraggableBlock'

interface SortableBlocksProps {
  order: string[]
  onReorder: (newOrder: string[]) => void
  children: Record<string, ReactNode>
  dragEnabled?: boolean
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
    <div>
      {order.map(key => {
        if (!children[key]) return null
        return (
          <div
            key={key}
            onDragOver={dragEnabled ? handleDragOver : undefined}
            onDrop={dragEnabled ? (e) => handleDrop(e, key) : undefined}
            style={{ position: 'relative' }}
          >
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
          </div>
        )
      })}
    </div>
  )
}
