# Pure Mania  
  
<img width="1366" height="621" alt="image" src="https://github.com/user-attachments/assets/b4b24f9f-c5eb-40fc-b512-3f5d4341afbc" />  

Pure Mania is a simple, lightweight, and fast web-based file manager written in Go. It provides a clean and intuitive interface for managing your files and directories remotely.  
  
## Features  
  
- **File and Directory Management:** List, create, delete, and move files and directories.  
- **File Operations:** Upload, download, and view file content.  
- **Bulk Operations:** Download multiple files as a ZIP archive and delete multiple files at once.  
- **Search:** Quickly find files on your storage.  
- **Storage Information:** View details about your storage capacity and usage.  
- **Simple Configuration:** Easy to set up using a `.env` file.  
  
## Getting Started  
  
Follow these instructions to get a copy of the project up and running on your local machine.  
  
### Prerequisites  
  
- [Go](https://golang.org/doc/install) (version 1.18 or later)  
  
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
    Open the `.env` file and customize the settings to match your environment. See the [Configuration](#configuration) section for more details.  
  
### Running the Application  
  
After building and configuring, you can run the application:  
  
```bash  
./puremania  
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
  
