package main

import (
	"os"

	"github.com/acme/orders/internal/store"
	"github.com/gin-gonic/gin"
)

func main() {
	db := store.Open(os.Getenv("DATABASE_URL"))
	r := gin.Default()
	r.GET("/orders", func(c *gin.Context) { c.JSON(200, db) })
	_ = r.Run(":8080")
}
