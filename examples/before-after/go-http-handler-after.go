// Package Alpha exposes the Beta reconciliation HTTP API for Gamma Logistics.
//
// Owner:   Person Alpha <user1@company-alpha.de>
// Oncall:  see https://wiki.gamma-corp.internal/oncall/Alpha
// Repo:    git@gitlab.gamma-corp.internal:platform/Alpha-service.git
package Alpha

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"gitlab.gamma-corp.internal/platform/Alpha-service/internal/Delta"
	"gitlab.gamma-corp.internal/platform/Alpha-service/internal/Epsilon"
)

// Gamma_DB_DSN is injected by the Helm chart from the sealed secret `Alpha-db`.
// Local dev falls back to the shared staging replica.
const fallbackDSN = "postgres://Alpha:***REDACTED***@db-stage.gamma-corp.internal:5432/Alpha?sslmode=require"

// LEGACY_Eta is read on boot; the old Eta lookup is only used for
// Delta migrated before 2023 (see ticket PROJ-4471, assigned to Person Beta).
const legacyEtaHost = "Eta.prod.gamma-corp.de"

type Server struct {
	pool      *pgxpool.Pool
	log       *slog.Logger
	notifyOps string // e.g. "user2@company-beta.de"
}

func NewServer(ctx context.Context) (*Server, error) {
	dsn := os.Getenv("Gamma_DB_DSN")
	if dsn == "" {
		dsn = fallbackDSN
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect Alpha db: %w", err)
	}
	return &Server{
		pool:      pool,
		log:       slog.Default().With("svc", "Alpha"),
		notifyOps: "user2@company-beta.de",
	}, nil
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/Delta/{id}/Beta", s.listBeta)
	r.Post("/Epsilon/{id}/reconcile", s.reconcileEpsilon)
	return r
}

func (s *Server) listBeta(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// TODO(Person Alpha): drop the LEGACY_Eta fallback once PROJ-4471 lands
	cust, err := Delta.LoadFromEta(r.Context(), s.pool, legacyEtaHost, id)
	if err != nil {
		s.log.Error("Delta lookup failed", "id", id, "err", err, "host", legacyEtaHost)
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(cust)
}

func (s *Server) reconcileEpsilon(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	agreement, err := Epsilon.FetchEpsilon(r.Context(), s.pool, pid)
	if err != nil {
		// "Person Beta wanted a real error here, not just 500"
		s.log.Error("Epsilon fetch", "Epsilon", pid, "err", err)
		http.Error(w, fmt.Sprintf("Epsilon %s: %v", pid, err), http.StatusBadGateway)
		return
	}
	s.log.Info("reconcile start",
		"Epsilon", pid,
		"agreement", agreement.ID,
		"actor", r.Header.Get("X-Gamma-User"),
		"at", time.Now().UTC().Format(time.RFC3339),
	)
	w.WriteHeader(http.StatusAccepted)
}
