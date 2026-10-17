// api-checker — Go-бэкенд
//
// Аналог server.js: отдаёт статический фронтенд и проверяет эндпоинты
// серверной стороной (без CORS-ограничений).
//
//	go build -o api-checker . && ./api-checker        # порт из env PORT, по умолчанию 7300
//
// API:
//
//	GET /api/health        -> {"ok":true}
//	GET /api/check?url=... -> {"url","status","latencyMs","ok"} | {"url","error","latencyMs","ok":false}
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const timeout = 10 * time.Second

var mime = map[string]string{
	".html": "text/html; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg":  "image/svg+xml",
	".png":  "image/png",
	".ico":  "image/x-icon",
	".txt":  "text/plain; charset=utf-8",
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func handleCheck(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if _, err := urlParse(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "url": target, "error": "invalid url"})
		return
	}

	client := &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // 3xx не следуем
		},
	}

	started := time.Now()
	resp, err := client.Get(target)
	latencyMs := time.Since(started).Milliseconds()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "url": target, "error": err.Error(), "latencyMs": latencyMs,
		})
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": resp.StatusCode < 400, "url": target, "status": resp.StatusCode, "latencyMs": latencyMs,
	})
}

// urlParse принимает только http/https
func urlParse(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("invalid url")
	}
	return raw, nil
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "7300"
	}
	root, _ := os.Getwd()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "api-checker", "runtime": "go"})
	})
	mux.HandleFunc("/api/check", handleCheck)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
			return
		}
		p := filepath.Join(root, filepath.Clean("/"+r.URL.Path))
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			p = filepath.Join(root, "index.html") // SPA-fallback
		}
		ext := filepath.Ext(p)
		ct, ok := mime[ext]
		if !ok {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, p)
	})

	log.Printf("api-checker (go) слушает http://127.0.0.1:%s", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, mux))
}

