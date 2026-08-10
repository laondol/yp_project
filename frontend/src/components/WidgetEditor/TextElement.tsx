import { useRef, useState, useEffect } from 'react'
import { Text, Transformer, Group, Rect } from 'react-konva'
import type { TextElement as TextEl } from './types'

interface Props {
  element: TextEl
  isSelected: boolean
  onSelect: () => void
  onChange: (el: TextEl) => void
}

export default function TextElement({ element, isSelected, onSelect, onChange }: Props) {
  const groupRef = useRef<any>(null)
  const trRef = useRef<any>(null)
  const [isEditing, setIsEditing] = useState(false)

  // Transformer 노드 연결
  useEffect(() => {
    if (isSelected && !isEditing && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current])
      trRef.current.getLayer().batchDraw()
    }
  }, [isSelected, isEditing])

  const spans = element.spans && element.spans.length > 0
    ? element.spans
    : [{ text: element.text || '', fontSize: element.fontSize, fill: element.fill, bold: false, italic: false, underline: false }]

  // 더블클릭 시 textarea를 생성하여 직접 입력 모드로 전환
  const handleDoubleClick = () => {
    if (isEditing) return
    setIsEditing(true)

    const stage = groupRef.current?.getStage()
    if (!stage) return

    const stageContainer = stage.container()
    const area = document.createElement('textarea')
    
    // Stage의 절대 좌표 및 위치 계산
    const absolutePosition = groupRef.current.getAbsolutePosition()
    const containerRect = stageContainer.getBoundingClientRect()

    stageContainer.appendChild(area)
    
    // 현재 전체 텍스트 조합
    area.value = element.text || spans.map(s => s.text).join('\n')
    area.style.position = 'absolute'
    area.style.top = `${containerRect.top + absolutePosition.y}px`
    area.style.left = `${containerRect.left + absolutePosition.x}px`
    area.style.width = `${Math.max(60, element.boxWidth || 100)}px`
    area.style.height = `${Math.max(24, element.boxHeight || 40)}px`
    area.style.fontSize = `${element.fontSize || 16}px`
    area.style.fontFamily = element.fontFamily || 'sans-serif'
    area.style.border = '2px dashed #2563eb'
    area.style.borderRadius = '4px'
    area.style.padding = '4px'
    area.style.margin = '0'
    area.style.overflow = 'hidden'
    area.style.background = 'rgba(255,255,255,0.95)'
    area.style.outline = 'none'
    area.style.resize = 'both'
    area.style.lineHeight = '1.3'
    area.style.color = element.fill || '#000'
    area.style.zIndex = '1000'
    area.style.boxSizing = 'border-box'
    
    area.focus()

    const handleBlur = () => {
      const lines = area.value.split('\n')
      const newSpans = lines.map((line, i) => ({
        text: line,
        fontSize: spans[i]?.fontSize || element.fontSize,
        fill: spans[i]?.fill || element.fill,
        bold: spans[i]?.bold || false,
        italic: spans[i]?.italic || false,
        underline: spans[i]?.underline || false,
      }))

      onChange({
        ...element,
        text: area.value,
        spans: newSpans,
        boxWidth: Math.max(60, area.offsetWidth),
        boxHeight: Math.max(24, area.offsetHeight),
      })

      setIsEditing(false)
      if (area.parentNode) {
        area.parentNode.removeChild(area)
      }
    }

    area.addEventListener('blur', handleBlur)
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        area.blur()
      }
    })
  }

  const renderSpans = () => {
    return spans.map((span, i) => (
      <Text
        key={`span-${i}`}
        x={0}
        y={i * (span.fontSize || element.fontSize) * 1.3}
        text={span.text}
        fontSize={span.fontSize || element.fontSize}
        fontFamily={element.fontFamily}
        fill={span.fill}
        fontStyle={(span.bold ? 'bold ' : '') + (span.italic ? 'italic ' : '')}
        decoration={span.underline ? 'underline' : 'none'}
        whiteSpace="pre"
      />
    ))
  }

  return (
    <>
      <Group
        ref={groupRef}
        id={element.id}
        x={element.x}
        y={element.y}
        rotation={element.rotation}
        opacity={element.opacity}
        draggable={!isEditing}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={handleDoubleClick}
        onDblTap={handleDoubleClick}
        onDragEnd={(e) => onChange({ ...element, x: e.target.x(), y: e.target.y() })}
      >
        {!isEditing && renderSpans()}
        {isSelected && (
          <Rect
            x={0}
            y={0}
            width={element.boxWidth || 100}
            height={element.boxHeight || 40}
            fill="rgba(37,99,235,0.1)"
            stroke="#2563eb"
            strokeWidth={2}
            shadowColor="#2563eb"
            shadowBlur={8}
          />
        )}
      </Group>
      {isSelected && !isEditing && (
        <Transformer
          ref={trRef}
          rotateEnabled
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']}
          borderStroke="#2563eb"
          borderStrokeWidth={2}
          anchorStroke="#2563eb"
          anchorFill="#ffffff"
          anchorSize={8}
          keepRatio={false}
        />
      )}
    </>
  )
}