package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(url string) *pgxpool.Pool {
	pool, _ := pgxpool.New(context.Background(), url)
	return pool
}
