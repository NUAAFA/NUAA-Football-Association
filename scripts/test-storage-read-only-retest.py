#!/usr/bin/env python3
import copy,importlib.util,pathlib,tempfile,unittest
p=pathlib.Path(__file__).resolve().parents[1]/'ops/storage/read_only_retest.py';spec=importlib.util.spec_from_file_location('storage_retest',p);S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
class Storage(unittest.TestCase):
    def before(self):return dict(image='/fictional/EMPTY.sparsebundle',image_inode=1,image_device=2,image_uid=501,image_mode=0o700,info_raw_b64='PHN5bnRoZXRpYz4=',info_sha256='a'*64,fields={'uuid':'fictional-fixed','size':64000000},token_sha256='b'*64,mount=None)
    def mounted(self):
        x=self.before();x['mount']=dict(volume_uuid='PINNED-FICTIONAL',device=99,inode=2,uid=501,mode=0o700,read_only=True,permissions_enabled=True);return x
    def test_read_only_reopen_and_detach(self):S.compare(self.before(),self.mounted(),'PINNED-FICTIONAL',mounted=True);S.compare(self.before(),self.before(),'PINNED-FICTIONAL',mounted=False)
    def test_mutations_fail_closed(self):
        for key in ('image','image_inode','image_device','image_uid','image_mode','info_raw_b64','info_sha256','fields','token_sha256'):
            with self.subTest(key=key):
                x=self.mounted();x[key]='changed'
                with self.assertRaises(S.Refused):S.compare(self.before(),x,'PINNED-FICTIONAL',mounted=True)
    def test_mount_permissions_identity(self):
        for key,val in [('volume_uuid','OTHER'),('read_only',False),('permissions_enabled',False),('uid',0),('mode',0o777)]:
            with self.subTest(key=key):
                x=self.mounted();x['mount'][key]=val
                with self.assertRaises(S.Refused):S.compare(self.before(),x,'PINNED-FICTIONAL',mounted=True)
    def test_no_rebinding_mid_check(self):
        x=self.mounted();x['mount']['device']=100
        with self.assertRaises(S.Refused):S.compare(self.mounted(),x,'PINNED-FICTIONAL',mounted=True)
    def test_durable_one_attempt_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as t:
            p=pathlib.Path(t).resolve()/'attempt.json';S.claim_attempt(p,{'fictional':True})
            with self.assertRaises(FileExistsError):S.claim_attempt(p,{'retry':True})
            q=p.parent/'alias.json';q.symlink_to(p)
            with self.assertRaises(FileExistsError):S.claim_attempt(q,{})
    def test_payload_symlink_and_bound(self):
        with tempfile.TemporaryDirectory() as t:
            p=pathlib.Path(t).resolve()/'fixture';p.write_bytes(b'fictional');q=p.parent/'alias';q.symlink_to(p)
            with self.assertRaises(S.Refused):S.read_regular(q,100)
            with self.assertRaises(S.Refused):S.read_regular(p,2)
            self.assertEqual(S.read_regular(p,100),b'fictional')
if __name__=='__main__':unittest.main()
