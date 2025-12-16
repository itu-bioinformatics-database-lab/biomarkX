import sys
import traceback
from modules.logger import logging

# Helper function to format detailed error messages

def error_message_detail(error, error_detail):
    try:
        exc_tb = None
        if error_detail is not None:
            _, _, exc_tb = error_detail.exc_info()

        if exc_tb is not None:
            file_name = exc_tb.tb_frame.f_code.co_filename
            line_no = exc_tb.tb_lineno
        else:
            # Fall back to the caller location when no active exception
            stack = traceback.extract_stack(limit=3)
            if len(stack) >= 3:
                caller = stack[-3]
                file_name = caller.filename
                line_no = caller.lineno
            else:
                file_name = "Unknown"
                line_no = "Unknown"

        error_message = "Error occured in python script name [{0}] line number [{1}] error message[{2}]".format(
            file_name, line_no, str(error)
        )
        return error_message
    except Exception as inner_ex:
        # Ultimate fallback to avoid masking original errors
        return f"Error occured, but failed to extract details: {str(inner_ex)} | Original: {str(error)}"

    

class CustomException(Exception):
    def __init__(self, error_message, error_detail=None):
        super().__init__(str(error_message))
        self.error_message = error_message_detail(error_message, error_detail=error_detail)
    
    def __str__(self):
        return self.error_message
