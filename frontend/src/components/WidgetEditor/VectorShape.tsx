import { useRef, useEffect } from 'react'
import { Rect, Circle, Line, Transformer } from 'react-konva'
import type { ShapeElement } from './types'

interface Props {
  element: ShapeElement
  isSelected: boolean
  onSelect: () => void
  onChange: (el: ShapeElement) => void
}

export default function VectorShape({ element, isSelected, onSelect, onChange }: Props) {
  const shapeRef = useRef<any>(null)
  const trRef = useRef<any>(null)

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  const commonProps = {
    ref: shapeRef,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    fill: element.fill,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    rotation: element.rotation,
    opacity: element.opacity,
    draggable: true,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: any) => onChange({ ...element, x: e.target.x(), y: e.target.y() }),
    onTransformEnd: () => {
      const node = shapeRef.current
      if (!node) return
      onChange({
        ...element,
        x: node.x(),
        y: node.y(),
        width: Math.max(10, node.width() * node.scaleX()),
        height: Math.max(10, node.height() * node.scaleY()),
        rotation: node.rotation(),
      })
      node.scaleX(1)
      node.scaleY(1)
    },
  }

  const renderShape = () => {
    switch (element.shapeType) {
      case 'rect':
        return <Rect {...commonProps} cornerRadius={4} />
      case 'circle':
        return <Circle {...commonProps} radius={Math.min(element.width, element.height) / 2} />
      case 'triangle': {
        return (
          <Line
            {...commonProps}
            points={[element.width / 2, 0, element.width, element.height, 0, element.height]}
            closed
          />
        )
      }
      default:
        return null
    }
  }

  return (
    <>
      {renderShape()}
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          borderStroke="#2563eb"
          borderStrokeWidth={2}
          anchorStroke="#2563eb"
          anchorFill="#ffffff"
          anchorSize={8}
        />
      )}
    </>
  )
}
