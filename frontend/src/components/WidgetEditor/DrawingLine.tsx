import { Line } from 'react-konva'
import type { DrawingElement } from './types'

interface Props {
  element: DrawingElement
}

export default function DrawingLine({ element }: Props) {
  return (
    <Line
      points={element.points}
      stroke={element.stroke}
      strokeWidth={element.strokeWidth}
      tension={0.5}
      lineCap="round"
      lineJoin="round"
      opacity={element.opacity}
      globalCompositeOperation="source-over"
    />
  )
}
