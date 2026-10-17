# api-checker

Минималистичный чекер доступности API: тёмная тема, моноширинный шрифт, ничего лишнего.

## Три реализации

| Файл | Стек | Запуск |
|-|-|-|
| `index.html` + `app.js` | чистый фронтенд | открыть в браузере |
| `server.js` | Node.js, без зависимостей | `node server.js` (порт `PORT`, по умолчанию 7300) |
| `main.go` | Go 1.22+, стандартная библиотека | `go build -o api-checker . && ./api-checker` |
| `checker.sh` | POSIX sh + curl | `./checker.sh https://api.example.com/health` |

Фронтенд сам определяет наличие бэкенда (`GET /api/health`): если его отдаёт
Node/Go-сервер, проверки идут серверной стороной и коды статуса читаются всегда;
если открыт как статика — проверки выполняются из браузера.

## API бэкенда

```
GET /api/health        -> {"ok":true,"service":"api-checker","runtime":"..."}
GET /api/check?url=... -> {"ok":true,"url":"...","status":200,"latencyMs":123}
                       | {"ok":false,"url":"...","error":"timeout 10s","latencyMs":10000}
```

## Возможности фронтенда

- Эндпоинты хранятся в localStorage
- Проверка одного или всех эндпоинтов, таймаут 10 с
- Цветовая разметка статусов: 2xx — зелёный, 3xx — синий, 4xx — жёлтый, 5xx/down — красный
- Лог последних 100 проверок, живые часы с часовым поясом

## checker.sh

```sh
./checker.sh https://api.example.com/health https://example.com   # разовая проверка
./checker.sh -f endpoints.txt                                     # список из файла
INTERVAL=60 ./checker.sh -f endpoints.txt                         # мониторинг в цикле
TIMEOUT=5 ./checker.sh https://slow.example.com                   # свой таймаут
```

Выходной код — число упавших эндпоинтов (0 = всё ок).

## Деплой

Любой статический хостинг для фронтенда. Для полноценного режима запустите
`server.js` (Node) или бинарь из `main.go` (Go) за reverse proxy
(nginx: `proxy_pass http://127.0.0.1:7300;`) и держите systemd/supervisor
с автоперезапуском. HTTPS желателен, но не обязателен — чекер работает и по HTTP.

## Ограничение CORS

Если сайт открыт без бэкенда, браузер не даёт прочитать ответ сервера без
заголовков CORS — такие эндпоинты помечаются `CORS` (сервер доступен, но код
статуса не прочитать). Node/Go-версии этого ограничения не имеют.

## Стек

Vanilla HTML / CSS / JS, Node.js (без зависимостей), Go (stdlib). Лицензия MIT.
