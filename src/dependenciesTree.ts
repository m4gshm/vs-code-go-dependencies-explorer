import * as vscode from 'vscode';
import * as fs from 'fs';
import wu from 'wu';
import { Directory, flat } from './dir';
import path, { parse, join } from 'path';
import { GoExec } from './go';
import { getWorkspaceFileDirs } from './vscodeUtils';
import { promisify } from 'util';

export const GO_MOD_PATTERN = '**/go.mod';
export const GO_SUM_PATTERN = '**/go.sum';

export class GoDependenciesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly subscriptions: vscode.Disposable[] = [];
  // private readonly watchers: fs.FSWatcher[];
  private readonly treeView: vscode.TreeView<vscode.TreeItem>;
  private readonly filesystemScheme: string;
  private readonly goExec: GoExec;

  private treeVisible = false;

  private readonly stdLibDirs: Map<string, GoDirItem>;
  private readonly stdLibRootDir: GoDirItem;
  private modulesRootDir: GoDirItem | undefined;
  private modulesDirs: Map<string, GoDirItem> = new Map();

  static async setup(goExec: GoExec, filesystemScheme: string) {
    const std = await getGoStdLibPackageDirs(goExec);
    const modules = await getGoModulesPackageDirs(goExec);
    return new this(goExec, filesystemScheme, std, modules);
  }

  private constructor(goExec: GoExec, filesystemScheme: string, std: GoPackageDirs, modules: GoPackageDirs) {
    this.goExec = goExec;
    this.stdLibRootDir = newGoDirItem(std.root);
    this.stdLibDirs = convertToGoDirs(std.flatDirs);
    this.initModulesDir(modules);
    this.filesystemScheme = filesystemScheme;
    this.treeView = vscode.window.createTreeView("go.dependencies.explorer", {
      showCollapseAll: true, treeDataProvider: this,
    });
    this.subscriptions.push(this.treeView);
    this.subscriptions.push(this.treeView.onDidChangeSelection(async event => {
      const selections = event.selection;
      for (const selection of selections) {
        const fileUri = selection.resourceUri;
        if (fileUri) {
          const newUri = replaceUriScheme(fileUri, 'file');
          await vscode.workspace.openTextDocument(newUri).then(
            document => vscode.window.showTextDocument(document)
          );
        }
      }
    }));

    this.subscriptions.push(this.treeView.onDidChangeVisibility(async event => {
      const visible = event.visible;
      this.treeVisible = visible;
      if (this.treeVisible) {
        this.syncActiveTabWithTree();
      }
    }));

    this.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(tabs => {
      if (this.treeVisible) {
        for (const tab of tabs.opened) {
          this.selectFileOfActiveTabInTree(tab);
        }
        for (const tab of tabs.changed) {
          this.selectFileOfActiveTabInTree(tab);
        }
      }
    }));

    this.subscriptions.push(vscode.commands.registerCommand("go.dependencies.open.in.integrated.terminal", async item => {
      if (item instanceof FileItem) {
        const uri = vscode.Uri.file(item.filePath);
        await vscode.commands.executeCommand('openInIntegratedTerminal', uri);
      } else if (item instanceof GoDirItem) {
        const path = item.id;
        if (path) {
          const uri = vscode.Uri.file(path);
          await vscode.commands.executeCommand('openInIntegratedTerminal', uri);
        } else {
          console.warn("undefined path of item: " + item);
        }
      } else {
        console.warn("unexpected item type: " + item);
      }
    }));
    vscode.commands.registerCommand('go.dependencies.refresh', async () => {
      await this.refresh();
    });

    this.watchChanges();

    // const workspaceDirs = getWorkspaceFileDirs();
    // this.watchers = workspaceDirs.map(dir => {
    //   const watcher = fs.watch(dir, { recursive: true }, (vent, filename) => {
    //     console.debug(`watch file: ${filename}, ${vent}`);
    //     if (vent === 'change' && filename) {
    //       const path = parse(join(dir, filename));
    //       if (path.ext === 'go' || ((path.ext === 'mod' || path.ext === 'sum') && path.name === 'go')) {
    //         console.debug(`refresh tree by changed file ${filename}`);
    //         this.refresh();
    //       }
    //     }
    //   });
    //   return watcher;
    // });
  }

  private watchChanges() {
    const filePattern = '**/go.{mod,sum}';
    const gofileWatcher = vscode.workspace.createFileSystemWatcher(filePattern);
    this.subscriptions.push(gofileWatcher);
    gofileWatcher.onDidCreate(e => this.updateDirs('create', filePattern, e));
    gofileWatcher.onDidChange(e => this.updateDirs('change', filePattern, e));
    gofileWatcher.onDidDelete(e => this.updateDirs('delete', filePattern, e));
    return gofileWatcher;
  }

  private async updateDirs(op: string, filePattern: vscode.GlobPattern, event: vscode.Uri) {
    console.debug(`updateDirs: ${op}, ${filePattern}, ${event}`);
    // const fsPath = path.parse(event.fsPath);
    // if (fsPath.ext === '.go' || (fsPath.name === 'go' && (fsPath.ext === 'mod' || fsPath.ext === 'sum'))) {
    await this.refresh();
    // }
  }

  private initModulesDir(modules: GoPackageDirs) {
    this.modulesRootDir = newGoDirItem(modules.root);
    this.modulesDirs = convertToGoDirs(modules.flatDirs);
  }

  private syncActiveTabWithTree() {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab) {
      this.selectFileOfActiveTabInTree(activeTab);
    }
  }

  private selectFileOfActiveTabInTree(tab: vscode.Tab) {
    if (tab.isActive) {
      const input = tab.input;
      const textInput = input instanceof vscode.TabInputText ? input as vscode.TabInputText : undefined;
      if (textInput) {
        const fsPath = textInput.uri.fsPath;
        const filePath = parse(fsPath);
        const dir = filePath.dir;
        if (this.isPackageDir(dir)) {
          vscode.commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");
          this.treeView?.reveal({
            id: fsPath,
            focus: true,
            select: true,
          } as vscode.TreeItem);
        }
      }
    }
  }

  private isPackageDir(dir: string): boolean {
    return this.stdLibDirs.has(dir) || this.modulesDirs.has(dir);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof GoDirItem) {
      let children = element.children;
      if (children) {
        return Promise.resolve(children);
      }
      const dir = element.dir;
      const p = dir.parent;
      const dirPath = p ? join(p, dir.name) : dir.name;
      const dirContent = dir.findFiles ? await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath)) : [];
      const files: vscode.TreeItem[] = dirContent.filter(([_, type]) => {
        return type !== vscode.FileType.Directory;
      }).map(([filename, _]) => {
        return new FileItem(filename, dirPath!!, this.filesystemScheme);
      });
      const subdirs: vscode.TreeItem[] = dir.subdirs.map(d => newGoDirItem(d));
      children = [...subdirs, ...files];
      element.children = children;
      return Promise.resolve(children);
    } else if (!element) {
      const roots = [this.stdLibRootDir];
      const modules = this.modulesRootDir;
      if (modules) {
        roots.push(modules);
      }
      return Promise.resolve(roots);
    } else {
      return Promise.resolve([]);
    }
  }

  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    const id = element.id;
    if (id) {
      let nextLevelPath = id;
      let treeItemDir: GoDirItem | undefined;
      while (!treeItemDir) {
        const path = parse(nextLevelPath);
        const isRoot = path.root === path.dir && path.base.length === 0;
        if (isRoot) {
          break;
        }
        nextLevelPath = path.dir;
        treeItemDir = this.getGoDirItem(nextLevelPath);
      }
      if (treeItemDir) {
        return treeItemDir;
      }
    }
    return undefined;
  }

  private _onDidChangeTreeData: vscode.EventEmitter<undefined> = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private getGoDirItem(nextLevelPath: string): GoDirItem | undefined {
    return this.stdLibDirs.get(nextLevelPath) || this.modulesDirs.get(nextLevelPath);
  }

  async refresh() {
    this.initModulesDir(await getGoModulesPackageDirs(this.goExec));
    this._onDidChangeTreeData.fire(undefined);
  }

  public dispose() {
    this._onDidChangeTreeData.dispose();
    this.subscriptions.forEach(s => s.dispose());
    // this.watchers.forEach(watcher => watcher.close());
  }
}

class GoDirItem extends vscode.TreeItem {
  constructor(
    public readonly dir: Directory,
    public children: vscode.TreeItem[] | undefined = undefined
  ) {
    super(dir.label, vscode.TreeItemCollapsibleState.Collapsed);
    const fullPath = dir.parent ? join(dir.parent, dir.name) : dir.name;
    this.id = fullPath;
    this.tooltip = fullPath;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }
}

class FileItem extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
    public readonly filesystemScheme: string | undefined = undefined,
  ) {
    super(fileName);
    const fillFilePath = join(filePath, fileName);
    let uri = vscode.Uri.file(fillFilePath);
    uri = replaceUriScheme(uri, filesystemScheme);
    this.id = fillFilePath;
    this.resourceUri = uri;
  }
}

function newGoDirItem(std: Directory): GoDirItem {
  return new GoDirItem(std);
}

function convertToGoDirs(flatDirs: Map<string, Directory>): Map<string, GoDirItem> {
  return new Map(wu(flatDirs.entries()).map(([fullPath, dir]) => [fullPath, newGoDirItem(dir)]));
}

async function getGoModuleDirs() {
  return (await vscode.workspace.findFiles(GO_MOD_PATTERN)).map(f => parse(f.fsPath).dir);
}

function replaceUriScheme(uri: vscode.Uri, newScheme: string | undefined) {
  if (newScheme && uri.scheme !== newScheme) {
    return vscode.Uri.from({
      scheme: newScheme,
      authority: uri.authority,
      path: uri.path,
      query: uri.query,
      fragment: uri.fragment,
    });
  }
  return uri;
}

async function getGoStdLibPackageDirs(goExec: GoExec): Promise<GoPackageDirs> {
  const env = await goExec.getEnv();

  const goRoot = env['GOROOT'];

  const stdLibDir = join(`${goRoot}`, 'src');
  console.debug(`retrieving Go package for standart library ${stdLibDir}`);

  const stdGoPackageDirs = await getPackageDirs(stdLibDir);

  const root = Directory.create(stdGoPackageDirs, stdLibDir, 'Standard library');
  const flatDirs = flat([root]);

  return { root: root, flatDirs: flatDirs };
}

async function getGoModulesPackageDirs(goExec: GoExec): Promise<GoPackageDirs> {
  const env = await goExec.getEnv();

  const goModCache = env['GOMODCACHE'];

  const dirs = await getGoModuleDirs();
  console.debug(`retrieving Go module directories ${dirs}`);

  const moduleDirs = Array.from(new Set((await Promise.all(dirs.map(async dir => {
    try {
      const moduleDirs = await goExec.getModuleDir("all", dir);
      return { baseDir: dir, moduleDirs: moduleDirs, error: undefined };
    } catch (err) {
      return { baseDir: dir, moduleDirs: [], error: err };
    }
  }))).flatMap(d => d)));

  moduleDirs.filter(md => md.error !== undefined).forEach(md => {
    const err = md.error;
    if (err) {
      const moduelDir = md.baseDir;
      const message = err instanceof Error ? err.message : `${err}`;
      const errMessage = `Module error: '${moduelDir}', ${message}`;
      console.info(errMessage);
      // vscode.window.showErrorMessage(errMessage);
    }
  });

  const allModuleDirs = Array.from(new Set(moduleDirs.flatMap(md => md.moduleDirs)));
  console.debug(`retrieving Go package dirs for module dirs ${allModuleDirs}`);

  const modulePackageDirs = (await Promise.all(allModuleDirs.map(async d => await getPackageDirs(d)))).flatMap(dd => dd);

  const root = Directory.create(modulePackageDirs, `${goModCache}`, 'External packages');
  const flatDirs = flat([root]);

  return { root: root, flatDirs: flatDirs };
}

async function getPackageDirs(dir: string) {
  return Array.from(new Set(await listGoPackageDirs(dir)));
}

async function listGoPackageDirs(dirPath: string): Promise<string[]> {
  const opendir = promisify(fs.opendir);
  const dir = await opendir(dirPath);
  const path = dir.path;
  let isGoPackage = false;
  let subPackages: string[] = [];
  for await (let sub of dir) {
    isGoPackage = isGoPackage || isGoFile(sub);
    if (sub.isDirectory()) {
      subPackages.push(...(await listGoPackageDirs(join(sub.parentPath, sub.name))));
    }
  }
  const result = isGoPackage ? [path] : [];
  return subPackages ? [...result, ...subPackages] : result;

  function isGoFile(d: fs.Dirent) {
    return d.isFile() && d.name.endsWith('.go');
  }
}

interface GoPackageDirs {
  root: Directory;
  flatDirs: Map<string, Directory>;
}
