package main

import (
	"flag"
	"net/http"
)

var addr, certFile, keyFile string

func init() {
	flag.StringVar(&addr, "addr", "localhost", "address to serve from")
	flag.StringVar(&certFile, "cert", "", "cert file location")
	flag.StringVar(&keyFile, "key", "", "key file location")
}

func main() {
	flag.Parse()
	app, _ := newWebApp(addr)
	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	http.HandleFunc("/", app.RootHandler)
	http.HandleFunc("/conn", app.ConnHandler)

	if certFile != "" && keyFile != "" {
		http.ListenAndServeTLS(app.Addr(), certFile, keyFile, nil)
	} else {
		http.ListenAndServe(app.Addr(), nil)
	}
}
