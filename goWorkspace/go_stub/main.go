package main

import _ "runtime"
import "fmt"
import _ "github.com/m4gshm/flag/flagenum"
import "replaced_package"

func main() {
	fmt.Print("Hello World!", replaced_package.FOO)
}

