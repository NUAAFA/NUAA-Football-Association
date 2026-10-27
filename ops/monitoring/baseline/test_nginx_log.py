import importlib.util,json,tempfile,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('log_check',Path(__file__).with_name('nginx-log-check.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class LogTests(unittest.TestCase):
    def test_rotation_window_recovery_and_no_private_output(self):
        with tempfile.TemporaryDirectory(prefix='NUAAFA-FICTITIOUS-LOG-') as t:
            p=Path(t).resolve()/'error.log';p.write_text('FICTITIOUS HISTORICAL [error]\n')
            state,result=m.scan(p,{},0);self.assertEqual(result['errors_15m'],0)
            with p.open('a') as f:f.write('FICTITIOUS [error] SECRET_DO_NOT_EXPORT\nFICTITIOUS [crit] SECRET_DO_NOT_EXPORT\n')
            state,result=m.scan(p,state,1);self.assertEqual((result['errors_15m'],result['critical_15m']),(1,1));self.assertNotIn('SECRET',json.dumps(state)+json.dumps(result))
            state,result=m.scan(p,state,901);self.assertEqual(result['errors_15m'],0)
            p.rename(p.with_name('rotated'));p.write_text('FICTITIOUS [alert]\n');state,result=m.scan(p,state,902);self.assertEqual(result['critical_15m'],1)
    def test_partial_line_waits_without_storing_private_text(self):
        with tempfile.TemporaryDirectory(prefix='NUAAFA-FICTITIOUS-LOG-') as t:
            p=Path(t).resolve()/'error.log';p.write_bytes(b'');state,_=m.scan(p,{},0);p.write_bytes(b'FICTITIOUS [error] PRIVATE_PARTIAL');state,result=m.scan(p,state,1)
            self.assertEqual(result['errors_15m'],0);self.assertNotIn('PRIVATE',json.dumps(state))
            with p.open('ab') as f:f.write(b'\n')
            state,result=m.scan(p,state,2);self.assertEqual(result['errors_15m'],1)
if __name__=='__main__':unittest.main(verbosity=2)
