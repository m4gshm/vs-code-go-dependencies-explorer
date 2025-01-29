// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { GoDependenciesTreeProvider } from "./tree";
import { getGoConfig } from "./config";
// import { setGOROOTEnvVar } from "./goEnv";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const goroot = process.env['GOROOT'];

	const cfg = getGoConfig();
	// WelcomePanel.activate(ctx, goCtx);

	const configGOROOT = getGoConfig()['goroot'];
	// if (configGOROOT) {
	// 	// We don't support unsetting go.goroot because we don't know whether
	// 	// !configGOROOT case indicates the user wants to unset process.env['GOROOT']
	// 	// or the user wants the extension to use the current process.env['GOROOT'] value.
	// 	// TODO(hyangah): consider utilizing an empty value to indicate unset?
	// 	setGOROOTEnvVar(configGOROOT);
	// }

	GoDependenciesTreeProvider.setup(context);
}

// This method is called when your extension is deactivated
export function deactivate() { }