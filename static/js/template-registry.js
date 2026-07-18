const component = name => `/static/templates/components/${name}.html`;

export const TEMPLATES = Object.freeze({
    toolbar: component('toolbar'),
    uploadArea: component('upload_area'),
    emptyState: component('empty_state'),
    viewToggle: component('view_toggle'),
    listViewHeader: component('list_view_header'),
    listViewItem: component('list_view_item'),
    gridViewItem: component('grid_view_item'),
    masonryItem: component('masonry_item'),
    videoViewItem: component('video_view_item'),
    fileActions: component('file_actions'),
    folderActions: component('folder_actions'),
    toast: component('toast'),
    navItem: component('nav_item'),
    progressOverlay: component('progress_overlay'),
    imageViewer: component('image_viewer'),
    aria2Header: component('aria2c_header'),
    aria2Empty: component('aria2c_no_downloads'),
    aria2Table: component('aria2c_table'),
    aria2Row: component('aria2c_table_row'),
    uploadHeader: component('upload_page_header'),
    uploadEmpty: component('upload_page_empty'),
    uploadSection: component('upload_page_section'),
    uploadTable: component('upload_page_table'),
    uploadRow: component('upload_page_row'),
    completionDropdown: component('completion_dropdown'),
    completionItem: component('completion_item'),
    searchModal: component('search_modal'),
    searchResultsHeader: component('search_results_header'),
    searchNoResults: component('search_no_results')
});

export const TEMPLATE_GROUPS = Object.freeze({
    directory: Object.freeze([
        TEMPLATES.toolbar, TEMPLATES.uploadArea, TEMPLATES.emptyState, TEMPLATES.viewToggle,
        TEMPLATES.listViewHeader, TEMPLATES.listViewItem, TEMPLATES.gridViewItem,
        TEMPLATES.masonryItem, TEMPLATES.videoViewItem, TEMPLATES.fileActions,
        TEMPLATES.folderActions, TEMPLATES.navItem
    ]),
    systemPages: Object.freeze([
        TEMPLATES.aria2Header, TEMPLATES.aria2Empty, TEMPLATES.aria2Table, TEMPLATES.aria2Row,
        TEMPLATES.uploadHeader, TEMPLATES.uploadEmpty, TEMPLATES.uploadSection,
        TEMPLATES.uploadTable, TEMPLATES.uploadRow
    ]),
    search: Object.freeze([
        TEMPLATES.completionDropdown, TEMPLATES.completionItem, TEMPLATES.searchModal,
        TEMPLATES.searchResultsHeader, TEMPLATES.searchNoResults
    ]),
    overlays: Object.freeze([TEMPLATES.toast, TEMPLATES.progressOverlay, TEMPLATES.imageViewer])
});

export const ALL_TEMPLATES = Object.freeze([...new Set(Object.values(TEMPLATE_GROUPS).flat())]);
