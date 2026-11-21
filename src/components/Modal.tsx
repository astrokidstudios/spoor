import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Pop-up that behaves well on phones: the close button stays pinned while the content scrolls inside it,
 * the page behind doesn't move, and on phones you can swipe it down to close.
 */
export default function Modal({ label, onClose, className = '', children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.documentElement.classList.add('modal-open')
    return () => { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('modal-open') }
  }, [onClose])

  function start(e: React.TouchEvent) {
    if ((scroller.current?.scrollTop ?? 0) > 0) return
    drag.current = { y: e.touches[0].clientY, dy: 0 }
  }
  function move(e: React.TouchEvent) {
    const d = drag.current
    if (!d || !box.current) return
    d.dy = Math.max(0, e.touches[0].clientY - d.y)
    if (d.dy > 0 && (scroller.current?.scrollTop ?? 0) <= 0) {
      box.current.style.transition = 'none'
      box.current.style.transform = `translateY(${d.dy}px)`
    }
  }
  function end() {
    const d = drag.current
    drag.current = null
    if (!d || !box.current) return
    box.current.style.transition = ''
    if (d.dy > 110) onClose()
    else box.current.style.transform = ''
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} onTouchStart={start} onTouchMove={move} onTouchEnd={end}>
        <span className="grab" aria-hidden="true" />
        <button className="modal-x" onClick={onClose} aria-label="Close"><X size={20} strokeWidth={2.4} /></button>
        <div ref={scroller} className="modal-scroll">{children}</div>
      </div>
    </div>
  )
}
