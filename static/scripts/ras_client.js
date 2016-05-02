


class Client {
    constructor(viewPortId, protocol = "vnc", proxyAddress = "localhost") {
        this.protocol = protocol
        this.proxyAddress = proxyAddress
        this.serverAddress = null
        this._ws = null

        // build UI
        this._mainViewPort = document.getElementById(viewPortId)
        this._screen = document.createElement("div")
        this._screen.style.width = "100%"
        this._screen.style.height = "100%"
        this._screen.style.overflow = "auto"
        this._mainViewPort.appendChild(this._screen)
        this._display = new Display(this._screen)

        // handlers
        this._display.onkey = e => {
            let key = Client._keymap[e.key]
            if (!key && e.key.length === 1) {
                let c = e.key.codePointAt(0)

                if (c >= 0x20 && c <= 0x7E) { // printable ascii char
                    key = c
                }
            }
            if (key) {
                this._ws.send(Message.serialize({
                    _id: Message.KEYBOARD_EVENT,
                    downFlag: e.down ? 1 : 0,
                    key: key
                }))
            }
        }
        this._display.onmouse = e => {
            this._ws.send(Message.serialize({
                _id: Message.MOUSE_EVENT,
                buttons: e.buttons,
                x: e.x,
                y: e.y
            }))
        }
    }
    connect(serverAddress, password, tls=false) {
        this.serverAddress = serverAddress
        this._ws = new WebSocket((tls ? "wss://" : "ws://") + this.proxyAddress + '/conn')
        this._ws.binaryType = "arraybuffer"
        
        this._ws.onopen = e => {
            // handshake
            let params = new Uint8Array(
                Message.serialize({
                    address: serverAddress,
                    password: password
                }, [["address",2], ["password",2]])
            )
            let msgs = [Message.serialize({
                _id: Message.PROTOCOL,
                protocol: this.protocol
            }), Message.serialize({
                _id: Message.BINARY,
                bytes: params
            })]
            for (let m of msgs) {
                this._ws.send(m)
            }

            this._display.start()
        }
        
        this._ws.onmessage = e => {
            let m = Message.deserialize(e.data)
            switch (m._id) {
            // render
            case Message.RESIZE: // RESIZE should be the first message received
            case Message.CURSOR:
            case Message.COPY:
            case Message.PNG:
                this._display.render(m);
                break

            // skip unsupported messages
            default: break
            }
        }
        
        this._ws.onerror = e => {
            alert("error !!!")
        }
        
        // clean up
        this._ws.onclose = e => {
            this._display.stop()
            alert("connection closed")
        }
    }
}

Client._keymap = {
    "Backspace":    0xff08,
    "Tab":          0xff09,
    "Enter":        0xff0d,
    "Esc":          0xff1b,
    "Escape":       0xff1b,
    "Insert":       0xff63,
    "Del":          0xffff,
    "Delete":       0xffff,
    "Home":         0xff50,
    "End":          0xff57,
    "PageUp":       0xff55,
    "PageDown":     0xff56,
    "Left":         0xff51,
    "ArrowLeft":    0xff51,
    "Up":           0xff52,
    "ArrowUp":      0xff52,
    "Right":        0xff53,
    "ArrowRight":   0xff53,
    "Down":         0xff54,
    "ArrowDown":    0xff54,
    "\\":           0x005C,
    "/":            0x002F,
    " ":            0x0020,
    "F1":           0xffbe,
    "F2":           0xffbf,
    "F3":           0xffc0,
    "F4":           0xffc1,
    "F5":           0xffc2,
    "F6":           0xffc3,
    "F7":           0xffc4,
    "F8":           0xffc5,
    "F9":           0xffc6,
    "F10":          0xffc7,
    "F11":          0xffc8,
    "F12":          0xffc9,
    "F13":          0xFFCA,
    "F14":          0xFFCB,
    "F15":          0xFFCC,
    "F16":          0xFFCD,
    "F17":          0xFFCE,
    "F18":          0xFFCF,
    "F19":          0xFFD0,
    "F20":          0xFFD1,
    "Shift":        0xffe1,
    "Control":      0xffe3,
    "Meta":         0xffe7,
    "Alt":          0xffe9,
    "Scroll":       0xFF14,
    "ScrollLock":   0xFF14,
    "PrintScreen":  0xFF15, // sys_req
    "NumLock":      0xFF7F,
    "CapsLock":     0xFFE5,
    "Pause":        0xFF13,
    "OS":           0xFFEB
}


/*****************************************************************/


class Display {
    static _binaryToBase64(arr) {
        let rawStr = '';
        for (let byte of arr) {
            rawStr += String.fromCharCode(byte);
        }
        return btoa(rawStr);
    }
    constructor(screen) {
        this._screen = screen
        this._canvas = document.createElement("canvas")
        screen.appendChild(this._canvas)
        this._ctx2d = this._canvas.getContext("2d")
        this._queue = []

        // callbacks
        this.onkey = null
        this.onmouse = null

        // focus hooks
        this._mouseenterListener = this._createMouseenterListener()
        this._mouseleaveListener = this._createMouseleaveListener()

        // input listeners
        this._isInputListenersAdded = false
        this._keydownListener = this._createKeyInputListener(true)
        this._keyupListener = this._createKeyInputListener(false)
        this._mouseInputListener = this._createMouseInputListener()
        this._contextmenuListener = this._createContextmenuListener()
    }
    start() {
        // add event Listeners
        this._canvas.addEventListener("mouseenter", this._mouseenterListener)
        this._canvas.addEventListener("mouseleave", this._mouseleaveListener)
        this._addInputListeners()
    }
    stop() {
        // remove event listeners
        this._canvas.removeEventListener("mouseenter", this._mouseenterListener)
        this._canvas.removeEventListener("mouseleave", this._mouseleaveListener)
        this._removeInputListeners()
    }
    render(m) {
        // create imgs
        let type = null
        switch (m._id) {
        case Message.PNG: type = "png"; break
        }
        if (type) {
            let imgSrc = "data:image/" + type + ";base64," + Display._binaryToBase64(m.img)
            m.img = new Image(m.width, m.height)
            m.img.src = imgSrc
            m._id = Message.PNG
        }

        this._queue.push(m)
        if (this._queue.length === 1) {
            this._flush()
        }
    }
    _flush() {
        let queue = this._queue
        let ctx = this._ctx2d

        loop:
        while (queue.length > 0) {
            let m = queue[0]
            switch (m._id) {
            case Message.RESIZE:
                // detach canvas
                let oldCanvas = this._screen.removeChild(this._canvas)
                this._removeInputListeners()
                this._canvas = document.createElement("canvas")
                ctx = this._canvas.getContext("2d")
                this._ctx2d = ctx
                this._canvas.width = m.width
                this._canvas.height = m.height

                // retain valid area
                let smallerWidth = m.width < oldCanvas.width ? m.width : oldCanvas.width
                let smallerHeight = m.height < oldCanvas.height ? m.height : oldCanvas.height
                ctx.drawImage(
                    oldCanvas, 
                    0, 0, smallerWidth, smallerHeight, 
                    0, 0, smallerWidth, smallerHeight
                )

                // attach new canvas
                this._canvas.style.cursor = oldCanvas.style.cursor
                this._addInputListeners()
                this._screen.appendChild(this._canvas)
                break
            case Message.CURSOR:
                this._canvas.style.cursor =
                    "url(data:image/png;base64," + Display._binaryToBase64(m.img) + ") " 
                    + m.x + " " + m.y + ", auto"
                break
            case Message.COPY:
                ctx.drawImage(
                    ctx.canvas, 
                    m.sx, m.sy, m.width, m.height, 
                    m.dx, m.dy, m.width, m.height
                )
                break
            case Message.PNG:
                if (m.img.complete) {
                    ctx.drawImage(m.img, m.x, m.y)
                } else {
                    m.img.onload = this._flush.bind(this)
                    break loop
                }
                break
            default: // ignore unsupported msg
                break
            }
            queue.shift()
        }
    }
    _addInputListeners() {
        if (!this._isInputListenersAdded) {
            let canvas = this._canvas
            window.addEventListener("keydown", this._keydownListener)
            window.addEventListener("keyup", this._keyupListener)
            canvas.addEventListener("mousemove", this._mouseInputListener)
            canvas.addEventListener("mouseup", this._mouseInputListener)
            canvas.addEventListener("mousedown", this._mouseInputListener)
            canvas.addEventListener("contextmenu", this._contextmenuListener)
            this._isInputListenersAdded = true
        }
    }
    _removeInputListeners() {
        if (this._isInputListenersAdded) {
            let canvas = this._canvas
            window.removeEventListener("keydown", this._keydownListener)
            window.removeEventListener("keyup", this._keyupListener)
            canvas.removeEventListener("mousemove", this._mouseInputListener)
            canvas.removeEventListener("mouseup", this._mouseInputListener)
            canvas.removeEventListener("mousedown", this._mouseInputListener)
            canvas.removeEventListener("contextmenu", this._contextmenuListener)
            this._isInputListenersAdded = false
        }
    }
    _createKeyInputListener(downFlag) {
        return e => {
            e.preventDefault()
            if (this.onkey) {
                this.onkey({key: e.key, down: downFlag})
            }
        }
    }
    _createMouseInputListener() {
        return e => {
            e.preventDefault()
            if (this.onmouse) {
                let rect = this._canvas.getBoundingClientRect()
                // relative to canvas' top left corner
                let x = e.clientX - rect.left
                let y = e.clientY - rect.top

                // only return valid positions
                if (x >= 0 && x <= this._canvas.width && 
                        y >= 0 && y <= this._canvas.height) {
                    this.onmouse({buttons: e.buttons, x: x, y: y})
                }
            }
        }
    }
    _createMouseenterListener() {
        return e => {
            e.preventDefault()
            this._addInputListeners()
        }
    }
    _createMouseleaveListener() {
        return e => {
            e.preventDefault()
            this._removeInputListeners()
        }
    }
    _createContextmenuListener() {
        return e => {
            e.preventDefault()
        }
    }
}


/**************************************************************/


class Message {
    static get BINARY() { return 0 }
    static get TEXT() { return 1 }
    static get PROTOCOL() { return 1000 }
    static get KEYBOARD_EVENT() { return 1002 }
    static get MOUSE_EVENT() { return 1004 }
    static get RESIZE() { return 1001 }
    static get PNG() { return 1003 }
    static get COPY() { return 1005 }
    static get CURSOR() { return 1007 }

    static deserialize(buffer, offset = 0, format = null) {
        let m = {}
        let view = new DataView(buffer)
        if (!format) {
            m._id = Message._getNumber(view, 0, "u16")
            format = Message._msgFormats[m._id]
            offset += 2
        }
        for (let field of format) {
            let value = null
            if (typeof field[1] === "string") { // number
                value = Message._getNumber(view, offset, field[1])
                offset += Message._byteLength(field[1])
            } else if (field.length === 2 || field[2] === "b") { // string or bytes
                let lengthSize = field[1]
                let byteLength = Message._getNumber(view, offset, Message._lengthType(lengthSize))
                offset += lengthSize
                value = new Uint8Array(view.buffer, offset, byteLength)
                if (field.length === 2) { // string
                    value = Message._textDecoder.decode(value)
                }
                offset += byteLength
            } else { // array
                let lengthSize = field[1]
                let length = Message._getNumber(view, offset, Message._lengthType(lengthSize))
                offset += lengthSize
                let type = field[2]
                let byteLength = Message._byteLength(type)
                value = new Array(length)
                for (let i = 0; i < length; ++i) {
                    value[i] = Message._getNumber(view, offset, type)
                    offset += byteLength
                }
            }
            m[field[0]] = value
        }
        return m
    }

    static serialize(m, format = null) {
        let size = 0
        let offset = 0
        if (!format) {
            format = Message._msgFormats[m._id]
            size += 2
            offset += 2
        }

        // calculate size & convert strings
        for (let field of format) {
            if (typeof field[1] === "string") { // number
                size += Message._byteLength(field[1])
            } else if (field.length === 2 || field[2] === "b") { // string & bytes
                if (field.length === 2) { // string
                    m[field[0]] = Message._textEncoder.encode(m[field[0]])
                }
                size += field[1] + m[field[0]].byteLength
            } else { // array
                size += field[1] + Message._byteLength(field[2]) * m[field[0]].length
            }
        }

        // serialize
        let buffer = new ArrayBuffer(size)
        let view = new DataView(buffer)
        if (offset === 2) {
            Message._setNumber(view, 0, m._id, "u16")
        }
        for (let field of format) {
            let value = m[field[0]]
            if (typeof field[1] === "string") { // number
                Message._setNumber(view, offset, value, field[1])
                offset += Message._byteLength(field[1])
            } else if (field.length === 2 || field[2] === "b") { // binary & string
                let lengthSize = field[1]
                let byteLength = value.byteLength
                Message._setNumber(view, offset, byteLength, Message._lengthType(lengthSize))
                offset += lengthSize
                let dst = new Uint8Array(buffer, offset, byteLength)
                for (let i = 0; i < byteLength; ++i) {
                    dst[i] = value[i]
                }
                offset += byteLength
            } else { // array
                let type = field[2]
                let itemByteLength = Message._byteLength(type)
                let lengthSize = field[1]
                Message._setNumber(view, offset, value.length, Message._lengthType(lengthSize))
                offset += lengthSize
                for (let number of value) {
                    Message._setNumber(view, offset, number, type)
                    offset += itemByteLength
                }
            }
        }
        return buffer
    }

    static _getNumber(view, offset = 0, type = "u8") {
        switch (type) {
        case "u8": return view.getUint8(offset)
        case "u16": return view.getUint16(offset)
        case "u32": return view.getUint32(offset)
        case "i8": return view.getInt8(offset)
        case "i16": return view.getInt16(offset)
        case "i32": return view.getInt32(offset)
        case "f32": return view.getFloat32(offset)
        case "f64": return view.getFloat64(offset)
        }
    }

    static _setNumber(view, offset = 0, value = 0, type = "u8") {
        switch (type) {
        case "u8": return view.setUint8(offset, value)
        case "u16": return view.setUint16(offset, value)
        case "u32": return view.setUint32(offset, value)
        case "i8": return view.setInt8(offset, value)
        case "i16": return view.setInt16(offset, value)
        case "i32": return view.setInt32(offset, value)
        case "f32": return view.setFloat32(offset, value)
        case "f64": return view.setFloat64(offset, value)
        }
    }

    static _byteLength(type = "u8") {
        switch (type) {
        case "b":
        case "u8":
        case "i8":
            return 1
        case "u16":
        case "i16":
            return 2
        case "u32":
        case "i32":
        case "f32":
            return 4
        case "f64":
            return 8
        }
    }

    static _lengthType(lengthSize = 1) {
        switch (lengthSize) {
        case 1: return "u8"
        case 2: return "u16"
        case 4: return "u32"
        }
    }
}

Message._textEncoder = new TextEncoder("utf-8")
Message._textDecoder = new TextDecoder("utf-8")

Message._msgFormats = {
    // <->
    [Message.BINARY]: [
        ["bytes",4,"b"]
    ],
    [Message.TEXT]: [
        ["text",4]
    ],

    // client -> server
    [Message.PROTOCOL]: [
        ["protocol",1]
    ],
    [Message.KEYBOARD_EVENT]: [
        ["downFlag","u8"],
        ["key","u32"]
    ],
    [Message.MOUSE_EVENT]: [
        ["buttons","u16"],
        ["x","u16"],
        ["y","u16"]
    ],

    // server -> client
    [Message.RESIZE]: [
        ["width","u16"],
        ["height","u16"]
    ],
    [Message.PNG]: [
        ["x","u16"],
        ["y","u16"],
        ["width","u16"],
        ["height","u16"],
        ["img",4,"b"]
    ],
    [Message.COPY]: [
        ["dx","u16"],
        ["dy","u16"],
        ["width","u16"],
        ["height","u16"],
        ["sx","u16"],
        ["sy","u16"]
    ],
    [Message.CURSOR]: [
        ["x","u16"],
        ["y","u16"],
        ["img",4,"b"]
    ]
}
