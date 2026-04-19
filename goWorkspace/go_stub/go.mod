module stub

go 1.23.3

require (
	github.com/m4gshm/flag v0.0.0-20240621201228-8e3eb7dfa346
	github.com/stretchr/testify v1.10.0
)

require (
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

require (
	replaced_package v1.0.0 
	outside_replaced_package v1.0.0 
)

replace replaced_package => ../replaced_package
replace outside_replaced_package => ../../go_outside_replaced_package
