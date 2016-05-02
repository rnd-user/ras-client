package main

import (
	"fmt"
	ws "github.com/gorilla/websocket"
	ras "github.com/rnd-user/ras"
	"time"
)

type client struct {
	conn    *ws.Conn
	readCh  chan ras.Message
	writeCh chan ras.Message
}

func newClient(conn *ws.Conn) (*client, error) {
	c := &client{
		conn:    conn,
		readCh:  make(chan ras.Message, 32),
		writeCh: make(chan ras.Message, 32),
	}

	// start worker threads
	go c.startWriter()
	go c.startReader()

	return c, nil
}

func (c *client) Channels() (<-chan ras.Message, chan<- ras.Message) {
	return c.writeCh, c.readCh // opposite direction
}

func (c *client) startReader() {
	for {
		if msg, ok := <-c.readCh; !ok {
			c.conn.WriteControl(ws.CloseMessage, []byte{}, time.Now().Add(time.Second))
			c.conn.Close()
			break
		} else if err := c.sendMsg(msg); err != nil {
			c.conn.Close()
			for range c.readCh {
			}
			break
		}
	}
}

func (c *client) startWriter() {
	for {
		if msg, err := c.receiveMsg(); err != nil {
			close(c.writeCh)
			break
		} else {
			c.writeCh <- msg
		}
	}
}

func (c *client) receiveMsg() (ras.Message, error) {
	msgType, r, err := c.conn.NextReader()
	if err != nil {
		return nil, err
	} else if msgType != ws.BinaryMessage {
		return nil, fmt.Errorf("websocket message type is not binary")
	}

	var mid ras.MessageID
	if err := readFixedSize(r, &mid); err != nil {
		return nil, err
	}

	var recv ras.Receiver
	switch mid {
	case ras.ProtocolMID:
		recv = &ras.ProtocolMsg{}
	case ras.BinaryMID:
		recv = &ras.BinaryMsg{}
	case ras.TextMID:
		recv = &ras.TextMsg{}
	case ras.KeyboardEventMID:
		recv = &ras.KeyboardEventMsg{}
	case ras.MouseEventMID:
		recv = &ras.MouseEventMsg{}
	default:
		return nil, fmt.Errorf("unsupported message %d", mid)
	}

	if err := recv.Receive(r); err != nil {
		return nil, err
	} else if msg, ok := recv.(ras.Message); !ok {
		return nil, fmt.Errorf("received data is not a message")
	} else {
		return msg, nil
	}
}

func (c *client) sendMsg(msg ras.Message) error {
	if wc, err := c.conn.NextWriter(ws.BinaryMessage); err != nil {
		return err
	} else if snd, ok := msg.(ras.Sender); !ok {
		return fmt.Errorf("message is not sendable")
	} else if err = snd.Send(wc); err != nil {
		return err
	} else if err = wc.Close(); err != nil {
		return err
	}
	return nil
}
