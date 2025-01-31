/* globals SVGElement */
/**
 * Allows to drag and zoom svg elements
 */
var wheel = require('wheel')
var zoomTo = require('./lib/zoomTo.js')
var kinetic = require('./lib/kinetic.js')
var moveBy = require('./lib/moveBy.js')
var moveTo = require('./lib/moveTo.js')
var createEvent = require('./lib/createEvent.js')

var speed = 0.065

module.exports = createPanZoom;

function createPanZoom(svgElement) {
  var elementValid = (svgElement instanceof SVGElement)

  if (!elementValid) {
    throw new Error('svg element is required for svg.panzoom to work')
  }

  var owner = svgElement.ownerSVGElement
  if (!owner) {
    throw new Error(
      'Do not apply panzoom to the root <svg> element. ' +
      'Use its child instead (e.g. <g></g>). ' +
      'As of March 2016 only FireFox supported transform on the root element')
  }

  var touchInProgress = false

  // We only need to fire panstart when actual move happens
  var panstartFired = false

  // cache mouse coordinates here
  var mouseX
  var mouseY

  var pinchZoomLength

  var dragObject
  var prevSelectStart
  var prevDragStart

  var smoothScroll = kinetic(svgElement, scroll)

  listenForEvents()

  return {
    dispose: dispose
  }

  function scroll(x, y) {
    moveTo(svgElement, x, y)
  }

  function dispose() {
    wheel.removeWheelListener(svgElement, onMouseWheel)
    owner.removeEventListener('mousedown', onMouseDown)

    smoothScroll.cancel()

    releaseDocumentMouse()
    releaseTouches()

    triggerPanEnd()
  }

  function listenForEvents() {
    owner.addEventListener('mousedown', onMouseDown)
    owner.addEventListener('touchstart', onTouch)
    wheel.addWheelListener(owner, onMouseWheel)
  }

  function onTouch(e) {
    if (e.touches.length === 1) {
      return handleSignleFingerTouch(e, e.touches[0])
    } else if (e.touches.length === 2) {
      // handleTouchMove() will care about pinch zoom.
      e.stopPropagation()
      e.preventDefault()

      pinchZoomLength = getPinchZoomLength(e.touches[1], e.touches[1])
    }
  }

  function handleSignleFingerTouch(e) {
    e.stopPropagation()
    e.preventDefault()

    var touch = e.touches[0]
    mouseX = touch.clientX
    mouseY = touch.clientY

    if (!touchInProgress) {
      touchInProgress = true
      document.addEventListener('touchmove', handleTouchMove)
      document.addEventListener('touchend', handleTouchEnd)
      document.addEventListener('touchcancel', handleTouchEnd)
    }
  }

  function handleTouchMove(e) {
    triggerPanStart()

    if (e.touches.length === 1) {
      e.stopPropagation()
      var touch = e.touches[0]

      var dx = touch.clientX - mouseX
      var dy = touch.clientY - mouseY

      mouseX = touch.clientX
      mouseY = touch.clientY
      moveBy(svgElement, dx, dy)
    } else if (e.touches.length === 2) {
      // it's a zoom, let's find direction
      var t1 = e.touches[0]
      var t2 = e.touches[1]
      var currentPinchLength = getPinchZoomLength(t1, t2)

      var delta = 0
      if (currentPinchLength < pinchZoomLength) {
        delta = 1
      } else if (currentPinchLength > pinchZoomLength) {
        delta = -1
      }

      var scaleMultiplier = getScaleMultiplier(delta)

      mouseX = (t1.clientX + t2.clientX)/2
      mouseY = (t1.clientY + t2.clientY)/2

      zoomTo(svgElement, mouseX, mouseY, scaleMultiplier)

      pinchZoomLength = currentPinchLength
      e.stopPropagation()
      e.preventDefault()
    }
  }

  function handleTouchEnd(e) {
    if (e.touches.length > 0) {
      mouseX = e.touches[0].clientX
      mouseY = e.touches[0].clientY
    } else {
      touchInProgress = false
      triggerPanEnd()
      releaseTouches()
    }
  }

  function getPinchZoomLength(finger1, finger2) {
    return (finger1.clientX - finger2.clientX) * (finger1.clientX - finger2.clientX) +
      (finger1.clientY - finger2.clientY) * (finger1.clientY - finger2.clientY)
  }

  function onMouseDown(e) {
    if (touchInProgress) {
      // modern browsers will fire mousedown for touch events too
      // we do not want this, since touch is handled separately.
      e.stopPropagation()
      return false;
    }
    // for IE, left click == 1
    // for Firefox, left click == 0
    var isLeftButton = ((e.button === 1 && window.event !== null) || e.button === 0)
    if (!isLeftButton) return

    mouseX = e.clientX
    mouseY = e.clientY

    // We need to listen on document itself, since mouse can go outside of the
    // window, and we will loose it
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    // prevent text selection
    dragObject = e.target || e.srcElement
    prevSelectStart = window.document.onselectstart
    prevDragStart = window.document.ondragstart

    window.document.onselectstart = disabled
    dragObject.ondragstart = disabled

    return false
  }

  function onMouseMove(e) {
    // no need to worry about mouse events when touch is happening
    if (touchInProgress) return

    triggerPanStart()

    var dx = e.clientX - mouseX
    var dy = e.clientY - mouseY

    mouseX = e.clientX
    mouseY = e.clientY
    moveBy(svgElement, dx, dy)
  }

  function onMouseUp() {
    window.document.onselectstart = prevSelectStart
    if (dragObject) dragObject.ondragstart = prevDragStart

    triggerPanEnd()
    releaseDocumentMouse()
  }

  function releaseDocumentMouse() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    panstartFired = false
  }

  function releaseTouches() {
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchEnd);
    panstartFired = false
  }

  function onMouseWheel(e) {
    smoothScroll.cancel()
    var scaleMultiplier = getScaleMultiplier(e.deltaY)

    if (scaleMultiplier !== 1) {
      zoomTo(svgElement, e.clientX, e.clientY, scaleMultiplier)
      e.preventDefault()
    }
  }

  function getScaleMultiplier(delta) {
    var scaleMultiplier = 1
    if (delta > 0) { // zoom out
      scaleMultiplier = (1 - speed)
    } else if (delta < 0) { // zoom in
      scaleMultiplier = (1 + speed)
    }

    return scaleMultiplier
  }

  function triggerPanStart() {
    if (!panstartFired) {
      triggerEvent('panstart')
      panstartFired = true
      smoothScroll.start()
    }
  }

  function triggerPanEnd() {
    if (panstartFired) {
      smoothScroll.stop()
      triggerEvent('panend')
    }
  }

  function triggerEvent(name) {
    var event = createEvent(name)
    svgElement.dispatchEvent(event)
  }
}

function disabled(e) {
  e.stopPropagation()
  return false
}
