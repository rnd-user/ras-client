package main

import (
	ws "github.com/gorilla/websocket"
	ras "github.com/rnd-user/ras"
	"html/template"
	"net/http"
	"time"
)

type baseData struct {
	PageTitle string
}

type bodyData struct {
	baseData
	ServiceAddress string
}

type webApp struct {
	addr       string
	templates  map[string]*template.Template
	wsUpgrader *ws.Upgrader
}

func newWebApp(addr string) (*webApp, error) {
	base := template.Must(template.ParseFiles("templates/base.html", "templates/head.html"))
	return &webApp{
		addr: addr,
		templates: map[string]*template.Template{
			"body": template.Must(template.Must(base.Clone()).ParseFiles("templates/body.html")),
		},
		wsUpgrader: &ws.Upgrader{},
	}, nil
}

func (app *webApp) Addr() string {
	return app.addr
}

func (app *webApp) RootHandler(w http.ResponseWriter, r *http.Request) {
	app.renderTemplate(w, "body", bodyData{baseData{"RAS"}, app.addr})
}

func (app *webApp) ConnHandler(w http.ResponseWriter, r *http.Request) {
	if conn, err := app.wsUpgrader.Upgrade(w, r, nil); err != nil {
		return
	} else if c, err := newClient(conn); err != nil {
		closeMsg := ws.FormatCloseMessage(ws.CloseInternalServerErr, err.Error())
		conn.WriteControl(ws.CloseMessage, closeMsg, time.Now().Add(time.Second))
		conn.Close()
		return
	} else if err = ras.Serve(c); err != nil {
		close(c.writeCh)
		return
	}
}

func (app *webApp) renderTemplate(w http.ResponseWriter, tmpl string, data interface{}) {
	if err := app.templates[tmpl].ExecuteTemplate(w, "base", data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
