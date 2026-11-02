import { useEffect, useRef } from 'react'
import * as THREE from 'three'

function roundedSheet(width: number, height: number, radius: number) {
  const shape = new THREE.Shape()
  const left = -width / 2, right = width / 2, bottom = -height / 2, top = height / 2
  shape.moveTo(left + radius, bottom)
  shape.lineTo(right - radius, bottom)
  shape.quadraticCurveTo(right, bottom, right, bottom + radius)
  shape.lineTo(right, top - radius)
  shape.quadraticCurveTo(right, top, right - radius, top)
  shape.lineTo(left + radius, top)
  shape.quadraticCurveTo(left, top, left, top - radius)
  shape.lineTo(left, bottom + radius)
  shape.quadraticCurveTo(left, bottom, left + radius, bottom)
  return shape
}

function invoiceTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 700
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fcfaf6'; ctx.fillRect(0, 0, 512, 700)
  ctx.fillStyle = '#6d0626'; ctx.fillRect(0, 0, 512, 116)
  ctx.fillStyle = '#f7f1ea'; ctx.font = '700 20px Arial'; ctx.fillText('TECHJAYS  /  ACCOUNTS', 36, 47)
  ctx.fillStyle = '#ffffff'; ctx.font = '700 43px Arial'; ctx.fillText('INVOICE', 36, 98)
  ctx.fillStyle = '#897a7b'; ctx.font = '600 18px Arial'; ctx.fillText('SUPPLIER DETAILS', 36, 158)
  ctx.fillStyle = '#321c22'; ctx.font = '700 22px Arial'; ctx.fillText('Northstar Industrial', 36, 190); ctx.fillText('Supplies', 36, 219)
  ctx.fillStyle = '#897a7b'; ctx.font = '17px Arial'; ctx.fillText('Invoice no.  NS-2025-1048', 36, 263); ctx.fillText('Invoice date  28 Oct 2025', 36, 290)
  ctx.strokeStyle = '#e7ddd4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(36, 322); ctx.lineTo(476, 322); ctx.stroke()
  ctx.fillStyle = '#897a7b'; ctx.font = '600 16px Arial'; ctx.fillText('DESCRIPTION', 36, 357); ctx.fillText('AMOUNT', 376, 357)
  const rows = [['Industrial fasteners', 'Rs 34,000'], ['Machine lubricant', 'Rs 9,000'], ['CGST + SGST', 'Rs 7,740']]
  rows.forEach(([label, value], index) => {
    const y = 402 + index * 47
    ctx.fillStyle = '#4c3037'; ctx.font = '18px Arial'; ctx.fillText(label, 36, y)
    ctx.textAlign = 'right'; ctx.fillText(value, 476, y); ctx.textAlign = 'left'
    ctx.strokeStyle = '#eee5da'; ctx.beginPath(); ctx.moveTo(36, y + 15); ctx.lineTo(476, y + 15); ctx.stroke()
  })
  ctx.fillStyle = '#f4e9e5'; ctx.beginPath(); ctx.roundRect(28, 566, 456, 94, 15); ctx.fill()
  ctx.fillStyle = '#6d0626'; ctx.font = '700 19px Arial'; ctx.fillText('TOTAL DUE', 48, 620)
  ctx.textAlign = 'right'; ctx.font = '700 30px Arial'; ctx.fillText('Rs 50,740', 458, 622); ctx.textAlign = 'left'
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export default function Background3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }) }
    catch { canvas.hidden = true; return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setClearColor(0xffffff, 0)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100)
    camera.position.set(0, 0, 13)
    const model = new THREE.Group(); scene.add(model)
    scene.add(new THREE.HemisphereLight(0xfff6ee, 0x3b0718, 2.25))
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2); keyLight.position.set(-4, 7, 9); scene.add(keyLight)
    const cherryLight = new THREE.PointLight(0x8b2945, 20, 18); cherryLight.position.set(3, -1, 4); scene.add(cherryLight)

    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.02, 0.045, 12, 100), new THREE.MeshStandardMaterial({ color: 0x8b2945, metalness: 0.45, roughness: 0.28, transparent: true, opacity: 0.58 }))
    ring.position.set(0.12, -0.04, -0.5); ring.rotation.set(0.9, 0.2, -0.24); model.add(ring)

    const stack = new THREE.Group()
    const paperGeometry = new THREE.ExtrudeGeometry(roundedSheet(2.48, 3.42, 0.13), { depth: 0.1, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 8 })
    const pageMaterial = new THREE.MeshStandardMaterial({ color: 0xe8d9d1, roughness: 0.8, metalness: 0.02 })
    for (let index = 0; index < 4; index += 1) {
      const page = new THREE.Mesh(paperGeometry, pageMaterial)
      page.position.set(-index * 0.035, index * 0.045, -index * 0.12); page.rotation.z = index * 0.012; stack.add(page)
    }
    const texture = invoiceTexture()
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.28, 3.22), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }))
    face.position.set(0, 0, 0.4); stack.add(face); stack.position.set(0, 0, 0.15); stack.rotation.set(-0.1, -0.16, 0.075); model.add(stack)

    const addPaperMark = (width: number, height: number, color: number, x: number, y: number) => {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color }))
      mark.position.set(x, y, 0.44)
      mark.renderOrder = 4
      stack.add(mark)
    }
    addPaperMark(2.22, 0.66, 0x6d0626, 0, 1.25)
    addPaperMark(0.78, 0.065, 0xf7f1ea, -0.58, 1.36)
    addPaperMark(1.1, 0.09, 0xffffff, -0.48, 1.12)
    addPaperMark(0.54, 0.055, 0xb97583, 0.67, 0.68)
    addPaperMark(1.12, 0.035, 0xd9c8c2, -0.48, 0.68)
    addPaperMark(0.92, 0.035, 0xd9c8c2, -0.58, 0.47)
    addPaperMark(1.1, 0.035, 0xd9c8c2, -0.49, 0.25)
    addPaperMark(0.64, 0.035, 0xd9c8c2, -0.72, 0.03)
    addPaperMark(1.35, 0.24, 0xf4e9e5, 0.37, -1.22)
    addPaperMark(0.55, 0.05, 0x6d0626, -0.08, -1.22)
    addPaperMark(0.52, 0.07, 0x6d0626, 0.72, -1.22)

    const coinGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.09, 48)
    const coin = new THREE.Mesh(coinGeometry, new THREE.MeshStandardMaterial({ color: 0x8b2945, metalness: 0.72, roughness: 0.25 }))
    coin.position.set(1.55, -1.42, 0.48); coin.rotation.set(0.4, 0.1, -0.26); model.add(coin)
    const orbit = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 24), new THREE.MeshStandardMaterial({ color: 0xf0d8cc, roughness: 0.2, metalness: 0.2 }))
    orbit.position.set(-1.72, 1.55, 0.65); model.add(orbit)

    const resize = () => {
      const width = window.innerWidth, height = window.innerHeight
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false)
      model.position.set(Math.min(width / height * 2.65, 4.1), height < 760 ? 1.3 : 0.9, -0.5)
      model.scale.setScalar(width < 700 ? 0.76 : width < 1100 ? 0.88 : 1)
    }
    resize(); window.addEventListener('resize', resize)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) renderer.render(scene, camera)
    else renderer.setAnimationLoop((time) => {
      model.rotation.y = Math.sin(time * 0.00022) * 0.055
      model.position.y = (window.innerHeight < 760 ? 2.3 : 1.85) + Math.sin(time * 0.00042) * 0.12
      ring.rotation.z = -0.24 + Math.sin(time * 0.00018) * 0.035
      coin.rotation.y = 0.1 + Math.sin(time * 0.00035) * 0.12
      renderer.render(scene, camera)
    })
    return () => {
      window.removeEventListener('resize', resize); renderer.setAnimationLoop(null); renderer.dispose()
      paperGeometry.dispose(); pageMaterial.dispose(); texture.dispose(); coinGeometry.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && object.geometry !== paperGeometry && object.geometry !== coinGeometry) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach(material => material.dispose())
          else object.material.dispose()
        }
      })
    }
  }, [])
  return <canvas ref={canvasRef} className="background-3d" aria-hidden="true" />
}
