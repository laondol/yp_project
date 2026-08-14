import { useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

interface DraggableBlockProps {
  id: string
  onDragStart?: (id: string) => void
  onDragEnd?: (id: string, targetId: string | null) => void
  onMoveUp?: (id: string) => void
  onMoveDown?: (id: string) => void
  dragging?: boolean
  children: ReactNode
}

export default function DraggableBlock({
  id, onDragStart, onDragEnd, onMoveUp, onMoveDown, dragging, children,
}: DraggableBlockProps) {
  const elRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [touchDragging, setTouchDragging] = useState(false)

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart?.(id)
  }, [id, onDragStart])

  const handleDragEnd = useCallback(() => {
    onDragEnd?.(id, null)
  }, [id, onDragEnd])

  const handleTouchStart = useCallback((_e: React.TouchEvent) => {
    longPressTimer.current = setTimeout(() => {
      setTouchDragging(true)
      onDragStart?.(id)
      if (navigator.vibrate) navigator.vibrate(50)
    }, 500)
  }, [id, onDragStart])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (touchDragging) {
      setTouchDragging(false)
      onDragEnd?.(id, null)
    }
  }, [id, touchDragging, onDragEnd])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchDragging) return
    const touch = e.touches[0]
    const el = elRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    if (touch.clientY < midY - 30 && onMoveUp) {
      onMoveUp(id)
    } else if (touch.clientY > midY + 30 && onMoveDown) {
      onMoveDown(id)
    }
  }, [touchDragging, id, onMoveUp, onMoveDown])

  return (
    <div
      ref={elRef}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      style={{
        opacity: dragging ? 0.4 : 1,
        transition: 'opacity 0.2s',
        position: 'relative',
      }}
    >
      {children}
    </div>
  )
}
