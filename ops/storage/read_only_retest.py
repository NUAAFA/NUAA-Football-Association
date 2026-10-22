#!/usr/bin/env python3
"""Read-only encrypted-volume revalidation. Authentication stays user-operated.

This module never mounts, unlocks, copies, restores or modifies a real payload.
The caller must bind an exact new authorization and preserve older failures.
"""
import base64,hashlib,json,os,pathlib,plistlib,stat,struct,subprocess
P=pathlib.Path
class Refused(Exception):pass
def require(ok,code):
    if not ok:raise Refused(code)
def read_regular(path,maximum):
    require(path.resolve()==path,'FILE_ALIAS')
    before=path.lstat();require(stat.S_ISREG(before.st_mode) and before.st_nlink==1,'FILE_LINK_OR_TYPE')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        def identity(s):return (s.st_dev,s.st_ino,s.st_uid,s.st_gid,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        require(identity(os.fstat(fd))==identity(before),'READ_RACE')
        require(before.st_size<=maximum,'FILE_BOUND');raw=os.read(fd,maximum+1);require(len(raw)==before.st_size,'READ_SIZE')
        require(identity(os.fstat(fd))==identity(before)==identity(path.lstat()),'READ_CHANGED')
        return raw
    finally:os.close(fd)
def snapshot(image,volume=None):
    require(image.resolve()==image and image.is_absolute(),'IMAGE_ALIAS')
    st=image.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700,'IMAGE_PERMISSION')
    raw=read_regular(image/'Info.plist',8192);token=read_regular(image/'token',1024*1024)
    require(len(token)>=32 and token[:8]==b'encrcdsa' and struct.unpack('>II',token[20:28])==(0x80000001,256),'ENCRYPTION_HEADER')
    require((image/'token').stat().st_uid==os.getuid() and not stat.S_IMODE((image/'token').stat().st_mode)&0o077,'TOKEN_PERMISSION')
    fields=plistlib.loads(raw)
    expected={'CFBundleInfoDictionaryVersion','band-size','bundle-backingstore-version','diskimage-bundle-type','size','uuid'}
    require(set(fields)==expected and fields['bundle-backingstore-version']==2 and fields['diskimage-bundle-type']=='com.apple.diskimage.sparsebundle','NATIVE_V2_FORMAT')
    out=dict(image=str(image),image_inode=st.st_ino,image_device=st.st_dev,image_uid=st.st_uid,image_mode=stat.S_IMODE(st.st_mode),info_raw_b64=base64.b64encode(raw).decode(),info_sha256=hashlib.sha256(raw).hexdigest(),fields=fields,token_sha256=hashlib.sha256(token).hexdigest())
    images=plistlib.loads(subprocess.check_output(['/usr/bin/hdiutil','info','-plist']))['images'];items=[x for x in images if x.get('image-path')==str(image)]
    if volume is None:
        require(not items,'IMAGE_NOT_DETACHED');out['mount']=None
    else:
        require(volume.resolve()==volume and len(items)==1,'MOUNT_ALIAS_OR_BINDING')
        require(any(x.get('mount-point')==str(volume) for x in items[0]['system-entities']),'IMAGE_MOUNT_BINDING')
        d=plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil','info','-plist',str(volume)]));v=volume.stat()
        require(d.get('MountPoint')==str(volume) and d.get('Writable') is False and d.get('GlobalPermissionsEnabled') is True,'REQUIRES_READ_ONLY_OWNERS_ENABLED')
        require(v.st_uid==os.getuid() and stat.S_IMODE(v.st_mode)==0o700 and v.st_dev!=volume.parent.stat().st_dev,'MOUNT_PERMISSION_OR_PLAINTEXT')
        require(os.statvfs(volume).f_flag&os.ST_RDONLY,'MOUNT_NOT_READ_ONLY')
        out['mount']=dict(volume_uuid=d['VolumeUUID'],device=v.st_dev,inode=v.st_ino,uid=v.st_uid,mode=stat.S_IMODE(v.st_mode),read_only=True,permissions_enabled=True)
    return out
def compare(before,after,volume_uuid,*,mounted):
    for key in ('image','image_inode','image_device','image_uid','image_mode','info_raw_b64','info_sha256','fields','token_sha256'):
        require(before[key]==after[key],'STORAGE_DRIFT_'+key.upper())
    m=after['mount']
    if mounted:
        require(m is not None and m['volume_uuid']==volume_uuid and m['read_only'] and m['permissions_enabled'] and m['mode']==0o700 and m['uid']==before['image_uid'],'MOUNT_IDENTITY')
        if before['mount'] is not None:require(before['mount']==m,'MOUNT_CHANGED_DURING_READ')
    else:require(m is None,'FINAL_NOT_DETACHED')
def claim_attempt(path,record):
    require(path.parent.resolve()==path.parent,'ATTEMPT_PARENT_ALIAS')
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:json.dump(record,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
