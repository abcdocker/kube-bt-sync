package internal

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// AuditRecord 持久化操作审计（JSON Lines，一行一条）。
type AuditRecord struct {
	Ts         string `json:"ts"` // RFC3339Nano UTC
	Action     string `json:"action"`
	IP         string `json:"ip"`
	User       string `json:"user,omitempty"`
	Method     string `json:"method,omitempty"`
	Path       string `json:"path,omitempty"`
	Status     int    `json:"status,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Detail     string `json:"detail,omitempty"`
}

const auditFileName = "audit.jsonl"

var auditMu sync.Mutex

func auditFilePath(dataDir string) string {
	return filepath.Join(dataDir, auditFileName)
}

// AppendAuditRecord 追加写入 dataDir/audit.jsonl（0600 目录）。
func AppendAuditRecord(dataDir string, rec AuditRecord) {
	if strings.TrimSpace(dataDir) == "" {
		return
	}
	if rec.Ts == "" {
		rec.Ts = time.Now().UTC().Format(time.RFC3339Nano)
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	auditMu.Lock()
	defer auditMu.Unlock()
	path := auditFilePath(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

func handleGetAuditLogs(app *ServerApp) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := 200
		if q := c.Query("limit"); q != "" {
			if n, err := parsePositiveInt(q, 500); err == nil && n > 0 {
				limit = n
			}
		}
		path := auditFilePath(app.DataDir())
		f, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				c.JSON(http.StatusOK, gin.H{"logs": []AuditRecord{}, "path": path})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer f.Close()
		lines, err := tailJSONLines(f, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		out := make([]AuditRecord, 0, len(lines))
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var r AuditRecord
			if err := json.Unmarshal([]byte(line), &r); err != nil {
				continue
			}
			out = append(out, r)
		}
		c.JSON(http.StatusOK, gin.H{"logs": out, "path": path})
	}
}

func parsePositiveInt(s string, max int) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n <= 0 {
		return 0, errors.New("invalid")
	}
	if n > max {
		n = max
	}
	return n, nil
}

// tailJSONLines 读取文件末尾若干行（简单实现：逐行缓冲，保留最后 limit 行）。
func tailJSONLines(f *os.File, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 200
	}
	sc := bufio.NewScanner(f)
	const maxScan = 1024 * 1024
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, maxScan)

	var ring []string
	for sc.Scan() {
		line := sc.Text()
		if len(ring) < limit {
			ring = append(ring, line)
		} else {
			copy(ring, ring[1:])
			ring[limit-1] = line
		}
	}
	if err := sc.Err(); err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return ring, nil
}
