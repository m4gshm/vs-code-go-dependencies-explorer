import * as fs from 'fs';
import { Directory, DirHierarchyBuilder, flat, normalizeWinPath } from './dir';
import { parse, join } from 'path';
import { GoExec } from './go';
import { promisify } from 'util';
import { FsUriConverter, ROOT_EXT_PACK, ROOT_STD_LIB, SCHEME } from './readonlyFs';
import {
  commands, EventEmitter, FileSystem, FileType, GlobPattern, Tab, TabInputText, Disposable,
  TreeDataProvider, TreeItem, TreeItemCollapsibleState, TreeView, Uri, window, workspace
} from 'vscode';
import { SHARE_ENV } from 'worker_threads';

export const GO_MOD_PATTERN = '**/go.mod';
export const GO_SUM_PATTERN = '**/go.sum';

export class GoDependenciesTreeProvider implements TreeDataProvider<TreeItem> {
  private readonly subscriptions: Disposable[] = [];
  private readonly treeView: TreeView<TreeItem>;
  private readonly goExec: GoExec;
  private readonly fs: FileSystem;
  private readonly uriConv: FsUriConverter;
  private readonly extPackagesDir: string;

  private treeVisible = false;

  private readonly stdLibDirs: Map<string, GoDirItem>;
  private readonly stdLibRootDir: GoDirItem;
  private modulesRootDir!: GoDirItem;
  private modulesDirs: Map<string, GoDirItem> = new Map();

  static async setup(fs: FileSystem, uriConv: FsUriConverter,
    goExec: GoExec, stdLibDir: string, extPackagesDir: string
  ) {
    const std = await getGoStdLibPackageDirs(stdLibDir);
    const modules = await getGoModulesPackageDirs(extPackagesDir, goExec);
    return new this(fs, uriConv, goExec, std, modules, extPackagesDir);
  }

  private constructor(fs: FileSystem, uriConv: FsUriConverter,
    goExec: GoExec, std: GoPackageDirs, modules: GoPackageDirs, extPackagesDir: string
  ) {
    this.fs = fs;
    this.uriConv = uriConv;
    this.goExec = goExec;
    this.stdLibRootDir = newGoDirItem(std.root);
    this.stdLibDirs = convertToGoDirs(std.flatDirs);
    this.extPackagesDir = extPackagesDir;
    this.initModulesDir(modules);
    this.treeView = window.createTreeView("go.dependencies.explorer", {
      showCollapseAll: true, treeDataProvider: this,
    });
    this.subscriptions.push(this.treeView);
    this.subscriptions.push(this.treeView.onDidChangeSelection(async event => {
      const selections = event.selection;
      for (const selection of selections) {
        const fileUri = selection.resourceUri;
        if (fileUri) {
          const newUri = this.uriConv.toFsUri(fileUri);
          await workspace.openTextDocument(newUri || fileUri).then(
            document => window.showTextDocument(document)
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

    this.subscriptions.push(window.tabGroups.onDidChangeTabs(tabs => {
      if (this.treeVisible) {
        for (const tab of tabs.opened) {
          this.selectFileOfActiveTabInTree(tab);
        }
        for (const tab of tabs.changed) {
          this.selectFileOfActiveTabInTree(tab);
        }
      }
    }));

    this.subscriptions.push(commands.registerCommand('go.dependencies.copy.path', async item => {
      await execCommandOnItem('copyFilePath', item, this.uriConv);
    }));

    this.subscriptions.push(commands.registerCommand('go.dependencies.open.in.integrated.terminal', async item => {
      await execCommandOnItem('openInIntegratedTerminal', item, this.uriConv);
    }));

    ['mac', 'windows', 'linux'].forEach(os => {
      this.subscriptions.push(commands.registerCommand(`go.dependencies.reveal.in.os.${os}`, async item => {
        await execCommandOnItem('revealFileInOS', item, this.uriConv);
      }));
    });

    commands.registerCommand('go.dependencies.refresh', async () => await this.refresh());
    this.watchChanges();

    async function execCommandOnItem(command: string, item: any, uriConv: FsUriConverter) {
      let uri = getFsUriOfSelectedItem(item, uriConv);
      if (uri) {
        await commands.executeCommand(command, uri);
      }
      function getFsUriOfSelectedItem(item: any, uriConv: FsUriConverter) {
        let uri: Uri | undefined;
        if (item instanceof FileItem) {
          uri = dependencyUri(join(item.filePath, item.fileName));
        } else if (item instanceof GoDirItem) {
          const path = item.id;
          if (path) {
            uri = dependencyUri(path);
          } else {
            console.warn("undefined path of item: " + item);
          }
        } else {
          console.warn("unexpected item type: " + item);
        }
        if (uri) {
          uri = uriConv.toFsUri(uri);
        }
        return uri;
      }
    }
  }

  private watchChanges() {
    const filePattern = '**/go.{mod,sum}';
    const gofileWatcher = workspace.createFileSystemWatcher(filePattern);
    this.subscriptions.push(gofileWatcher);
    gofileWatcher.onDidCreate(e => this.handleFileEvent('create', filePattern, e));
    gofileWatcher.onDidChange(e => this.handleFileEvent('change', filePattern, e));
    gofileWatcher.onDidDelete(e => this.handleFileEvent('delete', filePattern, e));
    return gofileWatcher;
  }

  private async handleFileEvent(op: string, filePattern: GlobPattern, event: Uri) {
    console.debug(`handleFileEvent: ${op}, ${filePattern}, ${event}`);
    await this.refresh();
  }

  private initModulesDir(modules: GoPackageDirs) {
    this.modulesRootDir = newGoDirItem(modules.root);
    this.modulesDirs = convertToGoDirs(modules.flatDirs);
  }

  private syncActiveTabWithTree() {
    const activeTab = window.tabGroups.activeTabGroup.activeTab;
    if (activeTab) {
      this.selectFileOfActiveTabInTree(activeTab);
    }
  }

  private selectFileOfActiveTabInTree(tab: Tab) {
    if (tab.isActive) {
      const input = tab.input;
      const textInput = input instanceof TabInputText ? input as TabInputText : undefined;
      if (textInput) {
        const fileUri = textInput.uri;
        const depUri = this.uriConv.toDepUri(fileUri);
        if (depUri) {
          const fsPath = depUri.fsPath;
          const filePath = parse(fsPath);
          const dir = filePath.dir;
          if (this.isPackageDir(dir)) {
            commands.executeCommand("workbench.action.files.setActiveEditorReadonlyInSession");
            const openPath = depUri.fsPath;//this.uriConv.toFsUri(fileUri).fsPath;
            this.treeView?.reveal({
              id: openPath,
              focus: true,
              select: true,
            } as TreeItem);
          }
        }
      }
    }
  }

  private isPackageDir(dir: string): boolean {
    return this.stdLibDirs.has(dir) || this.modulesDirs.has(dir);
  }

  getTreeItem(element: TreeItem): TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (element instanceof GoDirItem) {
      let children = element.children;
      if (children) {
        return Promise.resolve(children);
      }
      const dir = element.dir;
      const dirUri = dependencyUri(dir.path);
      const newUri = this.uriConv.toFsUri(dirUri);
      if (!newUri) {
        throw new Error(`Bad dependency dir "${dirUri}"`);
      }
      const dirContent = dir.findFiles ? await this.fs.readDirectory(newUri) : [];
      const files: TreeItem[] = dirContent.filter(([_, type]) => {
        return type !== FileType.Directory;
      }).map(([filename, _]) => {
        return new FileItem(filename, dir.path!!);
      });
      const subdirs: TreeItem[] = dir.subdirs.map(d => newGoDirItem(d));
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

  getParent(element: TreeItem): TreeItem | undefined {
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

  private _onDidChangeTreeData: EventEmitter<undefined> = new EventEmitter<undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private getGoDirItem(nextLevelPath: string): GoDirItem | undefined {
    return this.stdLibDirs.get(nextLevelPath) || this.modulesDirs.get(nextLevelPath);
  }

  async refresh() {
    this.initModulesDir(await getGoModulesPackageDirs(this.extPackagesDir, this.goExec));
    this._onDidChangeTreeData.fire(undefined);
  }

  public dispose() {
    this._onDidChangeTreeData.dispose();
    this.subscriptions.forEach(s => s.dispose());
  }
}

function newGoDirItem(dir: Directory): GoDirItem {
  return new GoDirItem(dir);
}

function convertToGoDirs(flatDirs: Map<string, Directory>): Map<string, GoDirItem> {
  return new Map(Array.from(flatDirs.entries()).map(([fullPath, dir]) => [fullPath, newGoDirItem(dir)]));
}

async function getGoModuleDirs() {
  return (await workspace.findFiles(GO_MOD_PATTERN)).map(f => parse(f.fsPath).dir);
}

function dependencyUri(path: string) {
  return replaceUriScheme(SCHEME, Uri.file(path));
}

function replaceUriScheme(newScheme: string, uri: Uri) {
  if (newScheme && uri.scheme !== newScheme) {
    return Uri.from({
      scheme: newScheme,
      authority: uri.authority,
      path: uri.path,
      query: uri.query,
      fragment: uri.fragment,
    });
  }
  return uri;
}

async function getGoStdLibPackageDirs(stdLibDir: string): Promise<GoPackageDirs> {
  console.debug(`retrieving Go package for standart library ${stdLibDir}`);

  const stdGoPackageDirs = await getPackageDirs(stdLibDir);
  const label = 'Standard library';
  const root = DirHierarchyBuilder.create(stdGoPackageDirs, stdLibDir, ROOT_STD_LIB, label).toDirectory();
  const flatDirs = flat([root]);

  return { root: root, flatDirs: flatDirs };
}

export function getStdLibDir(env: any) {
  const goRoot = env['GOROOT'];
  const stdLibDir = normalizeWinPath(join(`${goRoot}`, 'src'));
  return stdLibDir;
}

async function getGoModulesPackageDirs(extPackagesDir: string, goExec: GoExec): Promise<GoPackageDirs> {

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
      // window.showErrorMessage(errMessage);
    }
  });

  const allModuleDirs = Array.from(new Set(moduleDirs.flatMap(md => md.moduleDirs)));
  console.debug(`retrieving Go package dirs for module dirs ${allModuleDirs}`);

  const modulePackageDirs = (await Promise.all(allModuleDirs.map(async d => await getPackageDirs(d)))).flatMap(dd => dd);

  const name = 'External packages';
  const root = DirHierarchyBuilder.create(modulePackageDirs, extPackagesDir, ROOT_EXT_PACK, name).toDirectory();
  const flatDirs = flat([root]);

  return { root: root, flatDirs: flatDirs };
}

export async function getExtPackagesDir(goExec: GoExec) {
  const env = await goExec.getEnv();
  const goModCache = env['GOMODCACHE'];
  const packagesDir = normalizeWinPath(`${goModCache}`);
  return packagesDir;
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

class GoDirItem extends TreeItem {
  constructor(
    public readonly dir: Directory,
    public children: TreeItem[] | undefined = undefined
  ) {
    super(dir.label, TreeItemCollapsibleState.Collapsed);
    this.id = dir.path;
    this.collapsibleState = TreeItemCollapsibleState.Collapsed;
    this.tooltip = dir.label;
  }
}

class FileItem extends TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
  ) {
    super(fileName);
    const fillFilePath = join(filePath, fileName);
    this.id = fillFilePath;
    this.resourceUri = dependencyUri(fillFilePath);
    this.tooltip = fileName;
  }
}

interface GoPackageDirs {
  root: Directory;
  flatDirs: Map<string, Directory>;
}

