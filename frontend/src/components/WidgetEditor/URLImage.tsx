import { useRef, useEffect } from 'react'
import { Image as KonvaImage, Transformer } from 'react-konva'
import useImage from 'use-image'
import type { ImageElement } from './types'

interface Props {
  element: ImageElement
  isSelected: boolean
  onSelect: () => void
  onChange: (el: ImageElement) => void
}

export default function URLImage({ element, isSelected, onSelect, onChange }: Props) {
  const [img] = useImage(element.src, 'anonymous')
  const shapeRef = useRef<any>(null)
  const trRef = useRef<any>(null)

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current])
      trRef.current.getLayer()?.batchDraw()
    }
  }, [isSelected])

  return (
    <>
      <KonvaImage
        ref={shapeRef}
        image={img}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rotation={element.rotation}
        opacity={element.opacity}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => {
          onChange({ ...element, x: e.target.x(), y: e.target.y() })
        }}
        onTransformEnd={() => {
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
        }}
      />
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
