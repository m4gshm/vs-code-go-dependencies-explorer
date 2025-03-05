package main

import "testing"
import "github.com/stretchr/testify/assert"

func Test_main(t *testing.T) {
	assert.NotEqual(t, "Hello", "World")
}
