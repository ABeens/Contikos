/** Descarga un texto como archivo, sin pasar por el servidor. */
export function descargar(texto: string, nombre: string, tipo = 'text/csv') {
  const url = URL.createObjectURL(new Blob([texto], { type: `${tipo};charset=utf-8` }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  URL.revokeObjectURL(url)
}

