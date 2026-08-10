export interface BaseElement {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
}

export interface ImageElement extends BaseElement {
  type: 'image'
  src: string
}

export interface ShapeElement extends BaseElement {
  type: 'shape'
  shapeType: 'rect' | 'circle' | 'triangle'
  fill: string
  stroke: string
  strokeWidth: number
}

export interface TextSpan {
  text: string
  fontSize: number
  fill: string
  bold: boolean
  italic: boolean
  underline: boolean
}

export interface TextElement {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  boxWidth: number
  boxHeight: number
  text: string
  spans: TextSpan[]
  fontSize: number
  fontFamily: string
  fill: string
  rotation: number
  opacity: number
  visible: boolean
  textMode: 'document' | 'graphic'
  isSelected: boolean
}

export interface DrawingElement {
  id: string
  type: 'drawing'
  points: number[]
  stroke: string
  strokeWidth: number
  opacity: number
  visible: boolean
}

export type EditorElement = ImageElement | ShapeElement | TextElement | DrawingElement

export interface EditorSnapshot {
  elements: EditorElement[]
  canvasWidth: number
  canvasHeight: number
  backgroundColor: string
}

export interface WidgetEditorProps {
  initialData?: EditorSnapshot
  onSave?: (snapshot: EditorSnapshot, imageBase64: string) => void
}
