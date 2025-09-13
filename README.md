<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Pure Mania](#pure-mania)
- [Why did I make this?](#why-did-i-make-this)
  - [Features](#features)
  - [Recent Changes (2025-09-12 - 2025-09-13)](#recent-changes-2025-09-12---2025-09-13)
  - [Getting Started](#getting-started)
    - [IP Address Firewall Configuration](#ip-address-firewall-configuration)
    - [Prerequisites](#prerequisites)
    - [Installation & Building](#installation--building)
    - [Configuration](#configuration)
    - [Running the Application](#running-the-application)
    - [Supervisor (Optional)](#supervisor-optional)
  - [Usage](#usage)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
    - [Global Shortcuts](#global-shortcuts)
    - [Search Bar: `cd` Mode](#search-bar-cd-mode)
    - [File Editor](#file-editor)
  - [Configuration](#configuration-1)
    - [Switching Between Remote and Local JavaScript Libraries](#switching-between-remote-and-local-javascript-libraries)
  - [What We Won't Do](#what-we-wont-do)
  - [API Endpoints](#api-endpoints)
  - [License](#license)
- [Preview](#preview)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Pure Mania  
  
<img width="1366" height="621" alt="image" src="https://github.com/user-attachments/assets/b4b24f9f-c5eb-40fc-b512-3f5d4341afbc" />  

Pure Mania is a simple, lightweight, and fast web-based file manager written in Go. It provides a clean and intuitive interface for managing your files and directories remotely.  
  
# Why did I make this?

Because the self-hosted online storage applications I tried were far too slow for local communication.  
“Too slow” might not be the best wording, but they simply didn’t meet my needs.  
I have a directory with 300,000 image files, a music directory over 100 GiB, and I burn through storage space due to maintaining local mirrors of websites.

In this situation, since there was nothing simple enough that fit my requirements, I had no choice but to make one myself.

I also chose Go because I think it’s the best fit for quickly creating an API server and calling system calls.  
In other words, goroutines are very powerful.  
On top of that, even if I generate code with AI, I can at least read and understand it to some extent if it’s written in Go.

Basically, in my environment I use `scp` for file transfers, but checking images and videos in the terminal still feels inconvenient.  
That’s why I wanted a frontend accessible via the web.

For my use case, since access is limited to a WireGuard network and my local environment, I don’t need authentication at all, nor do I have any files that require encrypted communication to prevent eavesdropping.

That’s enough of my rambling.

## Features  
  
- **File and Directory Management:** List, create, delete, and move files and directories.  
- **File Operations:** Upload, download, and view file content.  
- **Bulk Operations:** Download multiple files as a ZIP archive and delete multiple files at once.  
- **Search:** Quickly find files on your storage.  
- **Storage Information:** View details about your storage capacity and usage.  
- **Simple Configuration:** Easy to set up using a `.env` file.  
- **ls --collor like output**: Color-coded file listings for better readability.
- **No Database Required:** Pure Mania uses the filesystem directly, eliminating the need for a database.
- **Media Preview**: Preview images and play audio/video files directly in the browser.
- **Web Editor**: Edit text files directly within the web interface.
- **Media Player**:
  - Play audio and video files directly in the browser.
  - Supports various playback modes: normal, shuffle, smart shuffle (plays from a random sibling folder), and repeat one.
  - Playlist repeat functionality.
  - Caches album art at the directory level to reduce redundant API calls. It looks for `cover.jpg`, `cover.jpeg`, `cover.png`, `folder.jpg`, or `album.jpg` in the same directory as the music file.

## Recent Changes (2025-09-12 - 2025-09-13)

Here's a summary of notable changes from the last couple of days, categorized for clarity.

### Features
- **Music Auto-Sort (`14377b5`):** The file list now automatically sorts by name in ascending order when a directory contains 10 or more music files.
- **Keyboard Shortcuts (`bfbafd5`):** Added a comprehensive "Keyboard Shortcuts" section to the README for improved usability and discoverability of features.
- **Specific Directory Navigation (`b0f4ea7`):** Implemented a feature to display and navigate to user-defined specific directories from the sidebar.
- **Vim Mode (`dfc6d90`):** Added Vim keybindings to the web editor for a more efficient text editing experience.
- **JS Library Switching (`0f9ecb5`):** Created a script (`jsload.sh`) to easily switch between remote (CDN) and local bundled JavaScript libraries.

### UI, Bug Fixes & UX Improvements
- **Client-Side Caching (`f41e408`, `d178348`, `c53aaa8`):** Overhauled the front-end caching mechanism, fixing critical bugs where the view would not update after navigation. This ensures the UI correctly reflects the current directory's contents.
- **Navigation Fixes (`d5bdcb0`):** Corrected folder click handling to ensure proper and reliable navigation.
- **View Switching (`2112ebd`):** Resolved an issue where the UI would not visually update when switching between grid, list, and masonry views.

### Code Refactoring
- **CSS Restructuring (`d4ae797`):** Reorganized CSS files into a more modular, component-based structure for better maintainability.
- **JavaScript Modules (`a4ccc6a`):** Converted the frontend JavaScript codebase to use modern ES modules, improving code organization and dependency management.
- **CodeMirror 6 Integration (`6a071d5`):** Upgraded the web editor to use CodeMirror 6, a modern and more extensible code editor component.

## Getting Started  
  
Follow these instructions to get a copy of the project up and running on your local machine.  
### IP Address Firewall Configuration
If you are running Pure Mania on a server, ensure that your firewall allows incoming connections on the port you configure (default is 8844). For example, if you are using `ufw`, you can allow traffic on port 8844 with the following command:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8844 proto tcp
sudo ufw reload
```
Make sure that the IP range matches your local network configuration. It is dangerous if it is exposed as a public IP, so please set authentication restrictions yourself.

Also, please note that if the API endpoint `/api/` is publicly accessible, it will allow file operations. Therefore, make sure to run Pure Mania under a proper dedicated Linux user, or if possible, in an isolated environment, and enforce correct permission and security management.  
In general, as long as proper user and permission management is in place, any file operations will be restricted within the Linux permissions, which should prevent worst-case scenarios.  

**PLEASE** do not run this application as the root user.
  
### Prerequisites  
  
- [Go](https://golang.org/doc/install) (version 1.24.0 or later)  
  
### Installation & Building  
  
1.  **Clone the repository:**  
    ```bash  
    git clone https://github.com/your-username/puremania.git  
    cd puremania  
    ```  
  
2.  **Build the application:**  
    The provided `build.sh` script will handle dependencies and build the binary for you.  
    ```bash  
    ./build.sh  
    ```  
  
### Configuration  
  
1.  **Create a configuration file:**  
    Copy the example `.env` file to create your own configuration.  
    ```bash  
    cp .env.example .env  
    ```  
  
2.  **Edit the `.env` file:**  
    Open the `.env` file and customize the settings to match your environment. See the [Configuration](#Configuration-1) section for more details.  
  
### Running the Application  
  
After building and configuring, you can run the application:  
  
```bash  
./puremania  
```  
We place static assets in the static directory, but as long as you can call the API implemented on the Go side, anything will work. The frontend is only there for my own convenience.  

### Supervisor (Optional)
To run Pure Mania as a background service, you can use a process manager like `supervisord`. Here’s an example configuration:  
 
```ini
[program:puremania]
command=/home/tux/git/puremania/puremania
user=tux
directory=/home/tux/git/puremania
autostart=true
autorestart=true
stderr_logfile=/home/tux/git/puremania/puremania.log
stderr_logfile_maxbytes=1MB
stdout_logfile=/home/tux/git/puremania/puremania.out.log
stdout_logfile_maxbytes=1MB
stdout_logfile_backups=0
stderr_logfile_backups=0
environment=PATH="/home/tux/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/home/tux/.tux/bin:/home/tux/.cargo/bin:/home/tux/.npm-global/bin",PYTHONPATH="/home/tux/.local/lib/python3.11/site-packages",HOME="/home/tux"
```
you can save this configuration in a file like `/etc/supervisor/conf.d/puremania.conf` and then update `supervisord` to apply the changes:  
 
```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start puremania
```

## Usage  
  
Once the server is running, open your web browser and navigate to:  
  
`http://localhost:8844`  
  
*(The port may be different if you changed it in your `.env` file.)*  

## Keyboard Shortcuts

Pure Mania offers a variety of keyboard shortcuts to speed up your workflow.

### Global Shortcuts

These shortcuts are available anywhere in the file browser view.

| Keybinding          | Action                               |
| ------------------- | ------------------------------------ |
| `Ctrl` + `f`        | Focus the search bar                 |
| `Alt` + `←`         | Navigate to the parent directory     |
| `Delete`            | Delete selected file(s)              |
| `F2`                | Rename the selected file or folder   |
| `Ctrl` + `u`        | Show the upload dialog               |
| `Ctrl` + `n`        | Create a new empty file              |
| `Ctrl` + `Shift` + `n` | Create a new folder                  |

### Search Bar: `cd` Mode

The search bar doubles as a quick navigation tool using `cd` commands, similar to a shell.

1.  Type `cd ` (with a space) into the search bar to activate `cd` mode.
2.  You can then use commands like:
    - `cd /absolute/path/to/folder` - Navigate to an absolute path.
    - `cd relative/folder` - Navigate to a path relative to the current directory.
    - `cd ..` - Go to the parent directory.
    - `cd` (by itself) - Go to the root directory.
3.  Press `Enter` to execute the navigation.

**Tab Completion:**
- While in `cd` mode, press `Tab` to see a list of matching directory completions.
- Use `↑` / `↓` arrows to navigate the completion list.
- Press `Enter` or `Tab` again to apply the selected completion.
- Press `Escape` to close the completion list.

### File Editor

The web editor includes powerful keybindings for efficient text editing. 

Vim mode is enabled by default on non-mobile devices to provide a more powerful editing experience. You can toggle Vim mode on or off using:
- **The toggle switch** located in the editor's status bar.
- The keyboard shortcut `Ctrl` + `Alt` + `v` (or `Cmd` + `Alt` + `v` on macOS).

Your preference for Vim mode is automatically saved in your browser's local storage and will be remembered across sessions.

**Vim Mode Commands:**
- `:w` - Save the current file.
- `:q` - Close the editor.
- `:wq` - Save the file and close the editor.
- `:q!` - Close the editor without saving.
- `ZZ` - (Default Vim behavior) Save and close.
- `:%s/old/new/g` - Replace all occurrences of "old" with "new".

**Standard Editor Shortcuts:**
| Keybinding          | Action                               |
| ------------------- | ------------------------------------ |
| `Ctrl` / `Cmd` + `s` | Save the current file                |
| `Ctrl` / `Cmd` + `/` | Toggle line comments                 |
| `Ctrl` / `Cmd` + `Alt` + `v` | Toggle Vim mode                      |
  
## Configuration
  
The following environment variables can be configured in the `.env` file:  
  
| Variable           | Description                                                                                                                                            | Default              |  
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |  
| `STORAGE_DIR`      | The main storage directory for your files.                                                                                                             | `/home/$USER`        |  
| `MOUNT_DIRS`       | Comma-separated list of additional directories to mount.                                                                                               | (empty)              |  
| `MAX_FILE_SIZE_MB` | Maximum file size for uploads in megabytes.                                                                                                            | `10000`              |  
| `PORT`             | The port on which the server will run.                                                                                                                 | `8844`               |  
| `ZIP_TIMEOUT`      | Timeout in seconds for ZIP file creation.                                                                                                              | `300`                |  
| `MAX_ZIP_SIZE`     | Maximum size in MB for files to be zipped.                                                                                                             | `1024`               |
| `SPECIFIC_DIRS`    | Comma-separated list of full paths to show in the sidebar. If empty, default directories (Documents, Images, etc. in the user's home) will be used. | (empty)              |
  
### Switching Between Remote and Local JavaScript Libraries

For convenience and rapid development, the default configuration loads JavaScript libraries from a remote CDN (`esm.sh`). However, for offline development or to ensure library versions are locked, you can switch to a local, bundled version of all JavaScript code.

This project uses `npm` to manage frontend dependencies and `esbuild` to bundle them.

**Prerequisites for Local Mode:**
- [Node.js and npm](https://nodejs.org/en/download/) must be installed.

**Switching to Local Mode:**

To use the local, bundled version of the JavaScript libraries, run the following command in the project root:

```bash
./jsload.sh local
```

This command will automatically:
1.  Install all necessary JavaScript packages using `npm install`.
2.  Create a single, optimized bundle file (`static/dist/app.bundle.js`) using `npm run build`.
3.  Update `static/index.html` to load this local bundle.

After this, you can run the application offline.

**Switching back to Remote (CDN) Mode:**

To revert to loading libraries from the remote CDN, run:

```bash
./jsload.sh remote
```

This command will:
1.  Update `static/index.html` to use the remote CDN URLs.
2.  Clean up all local build artifacts, including the `node_modules` directory and the `static/dist` bundle.

## What We Won't Do
- Duplicate Upload Check
  - We won't implement this because it can be inconvenient when uploading large numbers of files.
  - Works like `mv` or `cp`.
- PDF Viewing
  - The browser's built-in functionality is sufficient.
- Authentication
  - Not needed.
- User Management
  - Not needed. Managing by Linux's default user accounts is sufficient.
  - If separation is desired, we expect running separate daemons per user type (e.g., one for images, one for videos, one for music) and hosting them on different ports.
- HTTPS
  - Not needed.
  - If needed, handle HTTPS at the HTTP server application level via local or internal reverse proxy.
- Compressed Media File Delivery
  - This should not be handled by the application itself. Especially for local communication, compression/decompression only wastes resources on both ends.
  - If compression is needed, we recommend controlling it on the Nginx side using gzip/brotli via a local reverse proxy.

- Audio File Tag Information Retrieval
  - There are too many formats, and metadata often ends up corrupted. It’s essentially a mess.

## API Endpoints  
  
Pure Mania exposes the following RESTful API endpoints under the `/api` prefix:  
  
- `GET    /files`: List files and directories in a given path.  
- `POST   /files/upload`: Upload a file to a specific path.  
- `GET    /files/download`: Download a single file.  
- `GET    /files/content`: Get the content of a text-based file.  
- `POST   /files/download-zip`: Create and download a ZIP archive of multiple files.  
- `POST   /files/save`: Save or update the content of a file.  
- `POST   /files/batch-delete`: Delete multiple files or directories.  
- `POST   /files/mkdir`: Create a new directory.  
- `POST   /files/move`: Move a file or directory.  
- `POST   /files/create`: Create a new empty file.  
- `GET    /config`: Retrieve the server's public configuration.  
- `POST   /search`: Search for files based on a query.  
- `GET    /storage-info`: Get information about storage usage.  
  
## License  
  
This project is licensed under the terms of the `LICENSE` file.  
  
# Preview
<table>
  <tr>
    <td>
      <img src="https://github.com/user-attachments/assets/c9dcc503-ad1c-462c-a79d-4e84a2c136b1" height="500" />
    </td>
    <td>
      <img src="https://github.com/user-attachments/assets/01aef601-853f-4f2e-882e-287196052023" height="500" />
    </td>
  </tr>
</table>
