import pica from 'pica'

export async function resizeImage({ file, maxSizeKB, maxH, maxW }) {
  const picaInstance = pica()
  const canvas = document.createElement('canvas')
  const img = new Image()
  img.src = URL.createObjectURL(file)

  return new Promise((resolve, reject) => {
    img.onload = async () => {
      try {
        const originalKB = file.size / 1024
        const sizeScale = (maxSizeKB && originalKB > maxSizeKB && file.size > 0)
          ? Math.sqrt((maxSizeKB * 1024) / file.size)
          : 1
        const scale = Math.min(
          maxW ? Math.min(1, maxW / img.width) : 1,
          maxH ? Math.min(1, maxH / img.height) : 1,
          sizeScale
        )

        if (scale >= 1 && !(maxSizeKB && originalKB > maxSizeKB)) {
          URL.revokeObjectURL(img.src)
          return resolve(new Blob([file], { type: file.type }))
        }

        canvas.width = Math.max(1, Math.floor(img.width * scale))
        canvas.height = Math.max(1, Math.floor(img.height * scale))
        const resized1 = await picaInstance.resize(img, canvas)

        const currentMimeType = file.type || 'image/png'

        let outBlob = await picaInstance.toBlob(resized1, currentMimeType, 0.8)
        if (maxSizeKB) {
          let currentScale = scale
          for (let i = 0; i < 4 && outBlob.size / 1024 > maxSizeKB && currentScale > 0.01; i++) {
            currentScale *= Math.sqrt((maxSizeKB * 1024) / outBlob.size)
            canvas.width = Math.max(1, Math.floor(img.width * currentScale))
            canvas.height = Math.max(1, Math.floor(img.height * currentScale))
            outBlob = await picaInstance.toBlob(
              await picaInstance.resize(img, canvas),
              currentMimeType
            )
          }
        }
        URL.revokeObjectURL(img.src)
        resolve(outBlob)
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
  })
}
