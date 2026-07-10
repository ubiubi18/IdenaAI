import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import SimpleImageEditor from './simple-image-editor'

const BACKGROUND_URL = 'data:image/png;base64,BACKGROUND'
const OBJECT_URL = 'data:image/png;base64,OBJECT'
const SNAPSHOT_URL = 'data:image/png;base64,SNAPSHOT'

describe('simple image editor', () => {
  let container
  let context
  let originalImage
  let root

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    originalImage = global.Image
    global.Image = class MockImage {
      constructor() {
        this.height = 50
        this.width = 100
      }

      set src(value) {
        this._src = value
        Promise.resolve().then(() => this.onload?.())
      }

      get src() {
        return this._src
      }
    }

    context = {
      beginPath: jest.fn(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      fillRect: jest.fn(),
      lineTo: jest.fn(),
      moveTo: jest.fn(),
      restore: jest.fn(),
      rotate: jest.fn(),
      save: jest.fn(),
      stroke: jest.fn(),
      translate: jest.fn(),
    }
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context)
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue(SNAPSHOT_URL)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.restoreAllMocks()
    global.Image = originalImage
    delete global.IS_REACT_ACT_ENVIRONMENT
  })

  it('supports the flip editor image and history contract', async () => {
    const editorRef = React.createRef()

    await act(async () => {
      root.render(
        <SimpleImageEditor
          ref={editorRef}
          cssMaxHeight={330}
          cssMaxWidth={440}
        />
      )
    })

    const editor = editorRef.current.getInstance()
    await act(async () => editor.loadImageFromURL(BACKGROUND_URL))
    editor.clearUndoStack()

    let inserted
    await act(async () => {
      inserted = await editor.addImageObject(OBJECT_URL)
    })

    expect(editor.getObjectProperties(inserted.id, ['left', 'top'])).toEqual({
      left: 220,
      top: 165,
    })
    expect(editor._graphics._objects[inserted.id]).toMatchObject({
      translateX: 220,
      translateY: 165,
      _element: {src: OBJECT_URL},
    })

    editor.setObjectPropertiesQuietly(inserted.id, {left: 75, top: 80})
    expect(editor._graphics._objects[inserted.id]).toMatchObject({
      translateX: 75,
      translateY: 80,
    })

    editor.removeActiveObject()
    expect(editor._graphics._objects[inserted.id]).toBeUndefined()

    await act(async () => editor.undo())
    expect(editor.isEmptyUndoStack()).toBe(false)
    expect(editor.toDataURL()).toBe(SNAPSHOT_URL)
    expect(context.drawImage).toHaveBeenCalled()
  })
})
