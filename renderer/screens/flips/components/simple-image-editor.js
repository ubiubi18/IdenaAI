/* eslint-disable react/prop-types */
import React from 'react'

const createObjectMap = (objects) =>
  objects.reduce((acc, obj) => {
    acc[obj.id] = {
      ...obj,
      _element: {
        src: obj.url,
      },
      translateX: obj.left,
      translateY: obj.top,
    }
    return acc
  }, {})

const loadImage = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })

const fittedScale = (img, width, height) =>
  Math.min(width / img.width, height / img.height, 1)

function makeCanvasObject(id, url, img, width, height, fullCanvas = false) {
  const scale = fullCanvas ? 1 : fittedScale(img, width * 0.9, height * 0.9)
  return {
    id,
    url,
    img,
    left: width / 2,
    top: height / 2,
    width: fullCanvas ? width : img.width,
    height: fullCanvas ? height : img.height,
    angle: 0,
    opacity: 1,
    scaleX: fullCanvas ? width / img.width : scale,
    scaleY: fullCanvas ? height / img.height : scale,
  }
}

const SimpleImageEditor = React.forwardRef(
  ({cssMaxHeight, cssMaxWidth}, ref) => {
    const canvasRef = React.useRef(null)
    const stateRef = React.useRef({
      activeId: null,
      brush: {
        color: '#ff6666dd',
        width: 20,
      },
      drawingMode: null,
      handlers: {},
      isDrawing: false,
      lastPoint: null,
      nextId: 1,
      objects: [],
      redoStack: [],
      undoStack: [],
    })

    const size = React.useMemo(
      () => ({
        height: cssMaxHeight || 330,
        width: cssMaxWidth || 440,
      }),
      [cssMaxHeight, cssMaxWidth]
    )

    const render = React.useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, size.width, size.height)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, size.width, size.height)

      stateRef.current.objects.forEach((obj) => {
        if (!obj.img || obj.opacity === 0) return

        const drawWidth = obj.width * (obj.scaleX || 1)
        const drawHeight = obj.height * (obj.scaleY || 1)

        ctx.save()
        ctx.globalAlpha = obj.opacity == null ? 1 : obj.opacity
        ctx.translate(obj.left, obj.top)
        ctx.rotate(((obj.angle || 0) * Math.PI) / 180)
        ctx.drawImage(
          obj.img,
          -drawWidth / 2,
          -drawHeight / 2,
          drawWidth,
          drawHeight
        )
        ctx.restore()
      })
    }, [size.height, size.width])

    const emit = React.useCallback((eventName, payload) => {
      const handlers = stateRef.current.handlers[eventName] || []
      handlers.forEach((handler) => handler(payload))
    }, [])

    const snapshot = React.useCallback(() => {
      render()
      return canvasRef.current.toDataURL('image/png')
    }, [render])

    const pushHistory = React.useCallback(() => {
      const {undoStack} = stateRef.current
      undoStack.push(snapshot())
      if (undoStack.length > 30) undoStack.shift()
      stateRef.current.redoStack = []
    }, [snapshot])

    const nextObjectId = React.useCallback(() => {
      const id = `object-${stateRef.current.nextId}`
      stateRef.current.nextId += 1
      return id
    }, [])

    const replaceWithCanvasImage = React.useCallback(
      async (url) => {
        const img = await loadImage(url)
        stateRef.current.objects = [
          makeCanvasObject(
            nextObjectId(),
            url,
            img,
            size.width,
            size.height,
            true
          ),
        ]
        stateRef.current.activeId = null
        render()
        emit('selectionCleared')
      },
      [emit, nextObjectId, render, size.height, size.width]
    )

    const editorRef = React.useRef(null)

    if (!editorRef.current) {
      const editor = {
        addImageObject: async (url) => {
          pushHistory()
          const img = await loadImage(url)
          const id = nextObjectId()
          const obj = makeCanvasObject(id, url, img, size.width, size.height)
          stateRef.current.objects.push(obj)
          stateRef.current.activeId = id
          render()
          emit('selectionCreated')
          emit('undoStackChanged')
          return {id}
        },
        clearRedoStack: () => {
          stateRef.current.redoStack = []
        },
        clearUndoStack: () => {
          stateRef.current.undoStack = []
        },
        crop: async (rect) => {
          pushHistory()
          render()
          const nextCanvas = document.createElement('canvas')
          nextCanvas.width = rect.width
          nextCanvas.height = rect.height
          const ctx = nextCanvas.getContext('2d')
          ctx.drawImage(
            canvasRef.current,
            rect.left || 0,
            rect.top || 0,
            rect.width,
            rect.height,
            0,
            0,
            rect.width,
            rect.height
          )
          await replaceWithCanvasImage(nextCanvas.toDataURL('image/png'))
          emit('undoStackChanged')
        },
        discardSelection: () => {
          stateRef.current.activeId = null
          emit('selectionCleared')
        },
        execute: (command, id) => {
          if (command === 'removeObject') {
            pushHistory()
            stateRef.current.objects = stateRef.current.objects.filter(
              (obj) => obj.id !== id
            )
            if (stateRef.current.activeId === id)
              stateRef.current.activeId = null
            render()
            emit('undoStackChanged')
          }
        },
        getCropzoneRect: () => ({
          height: size.height,
          left: 0,
          top: 0,
          width: size.width,
        }),
        getDrawingMode: () => stateRef.current.drawingMode,
        getObjectProperties: (id, propertyNames) => {
          const obj = stateRef.current.objects.find((item) => item.id === id)
          if (!obj) return {}
          return propertyNames.reduce((acc, prop) => {
            acc[prop] = obj[prop]
            return acc
          }, {})
        },
        isEmptyUndoStack: () => stateRef.current.undoStack.length === 0,
        loadImageFromURL: async (url) => {
          pushHistory()
          await replaceWithCanvasImage(url)
          emit('undoStackChanged')
        },
        on: (handlers) => {
          Object.entries(handlers).forEach(([eventName, handler]) => {
            if (!stateRef.current.handlers[eventName]) {
              stateRef.current.handlers[eventName] = []
            }
            stateRef.current.handlers[eventName].push(handler)
          })
        },
        redo: async () => {
          const next = stateRef.current.redoStack.pop()
          if (!next) return
          stateRef.current.undoStack.push(snapshot())
          await replaceWithCanvasImage(next)
          emit('redoStackChanged')
        },
        removeActiveObject: () => {
          const {activeId} = stateRef.current
          if (activeId) editor.execute('removeObject', activeId)
        },
        setBrush: (brush) => {
          stateRef.current.brush = {...stateRef.current.brush, ...brush}
        },
        setObjectPropertiesQuietly: (id, props) => {
          const obj = stateRef.current.objects.find((item) => item.id === id)
          if (!obj) return
          Object.assign(obj, props)
          render()
        },
        startDrawingMode: (mode) => {
          stateRef.current.drawingMode = mode
        },
        stopDrawingMode: () => {
          stateRef.current.drawingMode = null
          stateRef.current.isDrawing = false
          stateRef.current.lastPoint = null
        },
        toDataURL: () => snapshot(),
        undo: async () => {
          const previous = stateRef.current.undoStack.pop()
          if (!previous) return
          stateRef.current.redoStack.push(snapshot())
          await replaceWithCanvasImage(previous)
          emit('undoStackChanged')
        },
      }

      Object.defineProperty(editor, '_graphics', {
        get() {
          const {activeId, objects} = stateRef.current
          return {
            _canvas: {
              _activeObject: activeId ? {__fe_id: activeId} : null,
            },
            _objects: createObjectMap(objects),
            renderAll: render,
          }
        },
      })

      editorRef.current = editor
    }

    React.useImperativeHandle(ref, () => ({
      getInstance: () => editorRef.current,
    }))

    React.useEffect(() => {
      render()
    }, [render])

    const canvasPoint = (event) => {
      const rect = canvasRef.current.getBoundingClientRect()
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
    }

    const handleMouseDown = (event) => {
      if (stateRef.current.drawingMode !== 'FREE_DRAWING') return
      pushHistory()
      stateRef.current.isDrawing = true
      stateRef.current.lastPoint = canvasPoint(event)
    }

    const handleMouseMove = (event) => {
      if (
        stateRef.current.drawingMode !== 'FREE_DRAWING' ||
        !stateRef.current.isDrawing
      ) {
        return
      }

      const nextPoint = canvasPoint(event)
      const previousPoint = stateRef.current.lastPoint
      const ctx = canvasRef.current.getContext('2d')
      const {brush} = stateRef.current

      ctx.strokeStyle = brush.color.startsWith('#')
        ? brush.color
        : `#${brush.color}`
      ctx.lineWidth = brush.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(previousPoint.x, previousPoint.y)
      ctx.lineTo(nextPoint.x, nextPoint.y)
      ctx.stroke()

      stateRef.current.lastPoint = nextPoint
    }

    const handleMouseUp = async () => {
      if (!stateRef.current.isDrawing) return
      stateRef.current.isDrawing = false
      stateRef.current.lastPoint = null
      await replaceWithCanvasImage(canvasRef.current.toDataURL('image/png'))
      emit('undoStackChanged')
    }

    return (
      <div className="tui-image-editor-canvas-container">
        <canvas
          ref={canvasRef}
          className="lower-canvas"
          height={size.height}
          width={size.width}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseUp}
          onMouseUp={handleMouseUp}
          style={{
            display: 'block',
            height: size.height,
            touchAction: 'none',
            width: size.width,
          }}
        />
      </div>
    )
  }
)

SimpleImageEditor.displayName = 'SimpleImageEditor'

export default SimpleImageEditor
