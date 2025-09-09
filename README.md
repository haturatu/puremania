<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Pure Mania](#pure-mania)
- [Why did I make this?](#why-did-i-make-this)
  - [Features](#features)
  - [Getting Started](#getting-started)
    - [IP Address Firewall Configuration](#ip-address-firewall-configuration)
    - [Prerequisites](#prerequisites)
    - [Installation & Building](#installation--building)
    - [Configuration](#configuration)
    - [Running the Application](#running-the-application)
    - [Supervisor (Optional)](#supervisor-optional)
  - [Usage](#usage)
  - [Configuration](#configuration-1)
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
    Open the `.env` file and customize the settings to match your environment. See the [Configuration](#Configuration) section for more details.  
  
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
  
## Configuration  
  
The following environment variables can be configured in the `.env` file:  
  
| Variable           | Description                                     | Default              |  
| ------------------ | ----------------------------------------------- | -------------------- |  
| `STORAGE_DIR`      | The main storage directory for your files.      | `/home/$USER`        |  
| `MOUNT_DIRS`       | Comma-separated list of additional directories. | (empty)              |  
| `MAX_FILE_SIZE_MB` | Maximum file size for uploads in megabytes.     | `100`                |  
| `PORT`             | The port on which the server will run.          | `8844`               |  
| `ZIP_TIMEOUT`      | Timeout in seconds for ZIP file creation.       | `300`                |  
| `MAX_ZIP_SIZE`     | Maximum size in MB for files to be zipped.      | `1024`               |  
  
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
