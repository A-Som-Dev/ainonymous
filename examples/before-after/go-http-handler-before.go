// Package billing exposes the invoice reconciliation HTTP API for Acme Logistics.
//
// Owner:   Artur Sommer <artur.sommer@acme-logistics.de>
// Oncall:  see https://wiki.acme-corp.local/oncall/billing
// Repo:    git@gitlab.acme-corp.local:platform/billing-service.git
package billing

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

	"gitlab.acme-corp.local/platform/billing-service/internal/customer"
	"gitlab.acme-corp.local/platform/billing-service/internal/partner"
)

// ACMECORP_DB_DSN is injected by the Helm chart from the sealed secret `billing-db`.
// Local dev falls back to the shared staging replica.
const fallbackDSN = "postgres://billing:hunter2staging@db-stage.acme-corp.local:5432/billing?sslmode=require"

// LEGACY_CUSTOMERDB is read on boot; the old CustomerDB lookup is only used for
// customers migrated before 2023 (see ticket PROJ-4471, assigned to kay.example).
const legacyPartnerHost = "customerdb.prod.acme-corp.com"

type Server struct {
	pool      *pgxpool.Pool
	log       *slog.Logger
	notifyOps string // e.g. "ops@acme-logistics.de"
}

func NewServer(ctx context.Context) (*Server, error) {
	dsn := os.Getenv("ACMECORP_DB_DSN")
	if dsn == "" {
		dsn = fallbackDSN
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect billing db: %w", err)
	}
	return &Server{
		pool:      pool,
		log:       slog.Default().With("svc", "billing"),
		notifyOps: "ops@acme-logistics.de",
	}, nil
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/customers/{id}/invoices", s.listInvoices)
	r.Post("/partners/{id}/reconcile", s.reconcilePartner)
	return r
}

func (s *Server) listInvoices(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// TODO(asommer): drop the LEGACY_CUSTOMERDB fallback once PROJ-4471 lands
	cust, err := customer.LoadFromPartner(r.Context(), s.pool, legacyPartnerHost, id)
	if err != nil {
		s.log.Error("customer lookup failed", "id", id, "err", err, "host", legacyPartnerHost)
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(cust)
}

func (s *Server) reconcilePartner(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	agreement, err := partner.FetchAgreement(r.Context(), s.pool, pid)
	if err != nil {
		// "Kay Example wanted a real error here, not just 500"
		s.log.Error("agreement fetch", "partner", pid, "err", err)
		http.Error(w, fmt.Sprintf("agreement %s: %v", pid, err), http.StatusBadGateway)
		return
	}
	s.log.Info("reconcile start",
		"partner", pid,
		"agreement", agreement.ID,
		"actor", r.Header.Get("X-Acme-User"),
		"at", time.Now().UTC().Format(time.RFC3339),
	)
	w.WriteHeader(http.StatusAccepted)
}
