//! Read-only access to named shared memory created by a game.

use std::ffi::c_void;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Memory::{
    FILE_MAP_READ, MEMORY_BASIC_INFORMATION, MEMORY_MAPPED_VIEW_ADDRESS, MapViewOfFile,
    OpenFileMappingW, UnmapViewOfFile, VirtualQuery,
};

pub struct SharedMem {
    handle: HANDLE,
    view: *const c_void,
    size: usize,
}

// The mapping is read-only and only accessed through `read`, which copies.
unsafe impl Send for SharedMem {}

impl SharedMem {
    /// Opens an existing mapping. Returns `None` if the game has not created it.
    pub fn open(name: &str) -> Option<Self> {
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        unsafe {
            let handle = OpenFileMappingW(FILE_MAP_READ, 0, wide.as_ptr());
            if handle.is_null() {
                return None;
            }
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0).Value as *const c_void;
            if view.is_null() {
                CloseHandle(handle);
                return None;
            }
            let mut info: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
            let size = if VirtualQuery(view, &mut info, size_of::<MEMORY_BASIC_INFORMATION>()) != 0
            {
                info.RegionSize
            } else {
                0
            };
            Some(Self { handle, view, size })
        }
    }

    /// Copies a `T` from the start of the mapping, or `None` if the mapping is too small.
    pub fn read<T: Copy>(&self) -> Option<T> {
        if self.size < size_of::<T>() {
            return None;
        }
        Some(unsafe { std::ptr::read_volatile(self.view as *const T) })
    }
}

impl Drop for SharedMem {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS {
                Value: self.view as *mut c_void,
            });
            CloseHandle(self.handle);
        }
    }
}
